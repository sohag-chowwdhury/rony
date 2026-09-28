import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, runTransaction, setDoc } from 'firebase/firestore';
import { firebaseServices } from './firebase';
import { parseMoney } from './accounting';
import { useFormSafety } from './useFormSafety';
import { applyPersonalPayment, editPersonalEntry, PERSONAL_STORAGE_KEY, personalTotals, validatePersonalEntry, type PersonalEntry, type PersonalPayment } from './personalAccounting';
import './personal-ledger.css';

type LocalData = { entries: PersonalEntry[]; payments: Record<string, PersonalPayment[]> };
const empty = (): LocalData => ({ entries: [], payments: {} });
const today = () => new Date().toLocaleDateString('en-CA');
const money = (amount: number) => `BDT ${(amount / 100).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`;
function readLocal(): LocalData {
    const raw = localStorage.getItem(PERSONAL_STORAGE_KEY);
    if (!raw) return empty();
    const data = JSON.parse(raw) as LocalData;
    if (!Array.isArray(data.entries) || !data.payments || typeof data.payments !== 'object') throw Error('Personal data could not be loaded. Existing data has been preserved.');
    data.entries.forEach(validatePersonalEntry);
    return data;
}
export default function PersonalLedger() {
    const [data, setData] = useState<LocalData>(empty), [loading, setLoading] = useState(true), [error, setError] = useState('');
    const [form, setForm] = useState<PersonalEntry | 'new' | null>(null), [query, setQuery] = useState('');
    const [manage, setManage] = useState<{ entry: PersonalEntry; deleting: boolean } | null>(null);
    const services = firebaseServices, uid = services?.auth.currentUser?.uid;
    useEffect(() => {
        if (services && uid) return onSnapshot(collection(services.db, 'personalLedgers', uid, 'entries'), snapshot => {
            const entries = snapshot.docs.map(item => item.data() as PersonalEntry);
            try { entries.forEach(validatePersonalEntry); setData({ entries, payments: {} }); setError(''); }
            catch (reason) { setError(String(reason)); }
            setLoading(false);
        }, reason => { setError(reason.message); setLoading(false); });
        const refresh = () => { try { setData(readLocal()); setError(''); } catch (reason) { setError(String(reason)); } finally { setLoading(false); } };
        refresh(); window.addEventListener('storage', refresh);
        return () => window.removeEventListener('storage', refresh);
    }, [services, uid]);
    async function save(entry: PersonalEntry, payment?: PersonalPayment) {
        if (services && uid) {
            if (!navigator.onLine) throw Error('Reconnect before saving personal records.');
            const ref = doc(services.db, 'personalLedgers', uid, 'entries', entry.id);
            if (!payment) { validatePersonalEntry(entry); await setDoc(ref, entry); }
            else await runTransaction(services.db, async transaction => {
                const snapshot = await transaction.get(ref);
                if (!snapshot.exists()) throw Error('This personal entry no longer exists.');
                const updated = applyPersonalPayment(snapshot.data() as PersonalEntry, payment);
                transaction.update(ref, { paid: updated.paid, lastPaymentId: payment.id });
                transaction.set(doc(ref, 'payments', payment.id), payment);
            });
        } else {
            await navigator.locks.request(PERSONAL_STORAGE_KEY, () => {
                const current = readLocal();
                if (payment) {
                    const existing = current.entries.find(item => item.id === entry.id);
                    if (!existing) throw Error('Personal entry no longer exists.');
                    const updated = applyPersonalPayment(existing, payment);
                    current.entries = current.entries.map(item => item.id === entry.id ? updated : item);
                    current.payments[entry.id] = [...(current.payments[entry.id] || []), payment];
                } else { validatePersonalEntry(entry); current.entries.push(entry); }
                localStorage.setItem(PERSONAL_STORAGE_KEY, JSON.stringify(current)); setData(current);
            });
        }
    }
    async function changeEntry(entry: PersonalEntry, deleting: boolean) {
        const update = (current: PersonalEntry) => {
            if (current.deleted) throw Error('This personal entry has been deleted.');
            return deleting ? { ...current, deleted: true } : editPersonalEntry(current, entry);
        };
        if (services && uid) {
            if (!navigator.onLine) throw Error('Reconnect before changing personal records.');
            const ref = doc(services.db, 'personalLedgers', uid, 'entries', entry.id);
            await runTransaction(services.db, async transaction => {
                const snapshot = await transaction.get(ref);
                if (!snapshot.exists()) throw Error('This personal entry no longer exists.');
                transaction.set(ref, update(snapshot.data() as PersonalEntry));
            });
        } else {
            await navigator.locks.request(PERSONAL_STORAGE_KEY, () => {
                const current = readLocal();
                const existing = current.entries.find(item => item.id === entry.id);
                if (!existing) throw Error('This personal entry no longer exists.');
                const updated = update(existing);
                current.entries = current.entries.map(item => item.id === entry.id ? updated : item);
                localStorage.setItem(PERSONAL_STORAGE_KEY, JSON.stringify(current));
                setData(current);
            });
        }
    }
    const totals = personalTotals(data.entries);
    const entries = data.entries.filter(entry => !entry.deleted).filter(entry => `${entry.person} ${entry.reason}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    return <section className="personal-ledger">
        <div className="panel-heading"><div><h1>Personal</h1><p>Track personal loans, repayments, and outstanding balances separately from your business accounts.</p></div><button className="primary-button" disabled={loading || !!error} onClick={() => setForm('new')}>+ Add personal entry</button></div>
        <div className="personal-totals"><article className="panel"><span>To receive</span><h2>{money(totals.receivable)}</h2></article><article className="panel"><span>To pay</span><h2>{money(totals.payable)}</h2></article></div>
        <p className="personal-help">{services ? 'Personal records are saved privately to your signed-in account.' : 'Personal records are saved in this browser.'} Business reports and backups do not include these records.</p>
        {error && <p role="alert">Unable to load personal records: {error}</p>}
        <label className="personal-search">Search person or reason<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or reason" /></label>
        {loading ? <p role="status">Loading personal records…</p> : !error && <div className="panel personal-table"><table><thead><tr><th>Date / Person</th><th>Reason / Purpose</th><th>Type</th><th>Original</th><th>Repaid</th><th>Outstanding</th><th>Actions</th></tr></thead><tbody>
            {entries.map(entry => <tr key={entry.id}><td><strong>{entry.person}</strong><small>{entry.date}</small></td><td>{entry.reason}</td><td>{entry.direction === 'receivable' ? 'To receive' : 'To pay'}</td><td>{money(entry.amount)}</td><td>{money(entry.paid)}</td><td><strong>{money(entry.amount - entry.paid)}</strong>{entry.paid === entry.amount && <small>Settled</small>}</td><td><button className="outline-button" onClick={() => setForm(entry)}>{entry.paid < entry.amount ? 'Repayment / History' : 'View history'}</button><button className="outline-button" onClick={() => setManage({ entry, deleting: false })}>Edit</button><button className="outline-button" onClick={() => setManage({ entry, deleting: true })}>Delete</button></td></tr>)}
            {!entries.length && <tr><td colSpan={7}>{query ? 'No matching personal records.' : 'No personal entries yet. Add money you lent or borrowed.'}</td></tr>}
        </tbody></table></div>}
        {manage && <ManagePersonalEntry key={`${manage.entry.id}-${manage.deleting}`} entry={manage.entry} deleting={manage.deleting} onClose={() => setManage(null)} onSave={changeEntry} />}
        {form && <PersonalForm key={typeof form === 'string' ? 'new' : form.id} entry={form === 'new' ? null : data.entries.find(item => item.id === form.id) || form} payments={form === 'new' ? [] : data.payments[form.id] || []} onClose={() => setForm(null)} onSave={save} />}
    </section>;
}
function PersonalForm({ entry, payments, onClose, onSave }: { entry: PersonalEntry | null; payments: PersonalPayment[]; onClose: () => void; onSave: (entry: PersonalEntry, payment?: PersonalPayment) => Promise<void> }) {
    const [person, setPerson] = useState(''), [direction, setDirection] = useState<PersonalEntry['direction']>('receivable'), [amount, setAmount] = useState(''), [date, setDate] = useState(today), [reason, setReason] = useState('');
    const [history, setHistory] = useState(payments), [historyError, setHistoryError] = useState('');
    const safety = useFormSafety({ person, direction, amount, date, reason }, onClose);
    const services = firebaseServices, uid = services?.auth.currentUser?.uid;
    useEffect(() => {
        if (entry && services && uid) return onSnapshot(collection(services.db, 'personalLedgers', uid, 'entries', entry.id, 'payments'), result => { setHistory(result.docs.map(item => item.data() as PersonalPayment)); setHistoryError(''); }, error => setHistoryError(error.message));
    }, [entry?.id, services, uid]);
    return <div className="modal-backdrop"><section className="personal-dialog panel" role="dialog" aria-modal="true" aria-labelledby="personal-form-title"><h2 id="personal-form-title">{entry ? `${entry.person} — ${entry.direction === 'receivable' ? 'Receive repayment' : 'Pay back'}` : 'Add personal entry'}</h2>
        {entry && <><p>{entry.reason}</p><p>Outstanding: <strong>{money(entry.amount - entry.paid)}</strong></p><h3>Repayment history</h3>{historyError && <p role="alert">{historyError}</p>}{!history.length && !historyError && <p>No repayments recorded.</p>}<ul>{[...history].sort((a, b) => a.date.localeCompare(b.date)).map(item => <li key={item.id}>{item.date} · {money(item.amount)} {item.note && `· ${item.note}`}</li>)}</ul></>}
        {(!entry || entry.paid < entry.amount) && <form onSubmit={async event => {
            event.preventDefault(); if (!safety.start()) return;
            try {
                const value = parseMoney(amount);
                if (entry) await onSave(entry, { id: crypto.randomUUID(), amount: value, date, note: reason.trim() });
                else await onSave({ id: crypto.randomUUID(), person: person.trim(), direction, amount: value, paid: 0, date, reason: reason.trim(), createdAt: new Date().toISOString() });
                onClose();
            } catch (error) { safety.fail(error); } finally { safety.finish(); }
        }}><fieldset disabled={safety.busy}>
            {!entry && <><label>Person name<input autoFocus required maxLength={200} value={person} onChange={event => setPerson(event.target.value)} /></label><label>Entry type<select value={direction} onChange={event => setDirection(event.target.value as PersonalEntry['direction'])}><option value="receivable">Money lent — To receive</option><option value="payable">Money borrowed — To pay</option></select></label></>}
            <label>{entry ? 'Repayment amount (BDT)' : 'Amount (BDT)'}<input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" /></label>
            <label>Date<input required type="date" min={entry?.date} value={date} onChange={event => setDate(event.target.value)} /></label>
            <label>{entry ? 'Repayment note (optional)' : 'Reason / Purpose'}<textarea required={!entry} maxLength={4000} value={reason} onChange={event => setReason(event.target.value)} /></label>
            {safety.error && <p role="alert">{safety.error}</p>}<button className="primary-button" type="submit">{safety.busy ? 'Saving…' : entry ? 'Save repayment' : 'Save personal entry'}</button>
        </fieldset></form>}
        <button type="button" className="outline-button" disabled={safety.busy} onClick={safety.close}>Close</button>
    </section></div>;
}

function ManagePersonalEntry({ entry, deleting, onClose, onSave }: { entry: PersonalEntry; deleting: boolean; onClose: () => void; onSave: (entry: PersonalEntry, deleting: boolean) => Promise<void> }) {
    const [person, setPerson] = useState(entry.person), [direction, setDirection] = useState(entry.direction);
    const [amount, setAmount] = useState((entry.amount / 100).toFixed(2)), [date, setDate] = useState(entry.date), [reason, setReason] = useState(entry.reason);
    const safety = useFormSafety({ person, direction, amount, date, reason }, onClose);
    return <div className="modal-backdrop"><section className="personal-dialog panel" role="dialog" aria-modal="true" aria-labelledby="personal-manage-title">
        <h2 id="personal-manage-title">{deleting ? 'Delete personal entry?' : 'Edit personal entry'}</h2>
        {deleting && <p>Delete the entry for <strong>{entry.person}</strong> ({money(entry.amount)})? It will be removed from your list and outstanding totals. Its repayment history will be kept.</p>}
        <form onSubmit={async event => {
            event.preventDefault();
            if (!safety.start()) return;
            try {
                await onSave(deleting ? entry : { ...entry, person: person.trim(), direction, amount: parseMoney(amount), date, reason: reason.trim() }, deleting);
                onClose();
            } catch (error) { safety.fail(error); } finally { safety.finish(); }
        }}><fieldset disabled={safety.busy}>
            {!deleting && <>
                <label>Person name<input autoFocus required maxLength={200} value={person} onChange={event => setPerson(event.target.value)} /></label>
                <label>Entry type<select value={direction} onChange={event => setDirection(event.target.value as PersonalEntry['direction'])}><option value="receivable">Money lent ? To receive</option><option value="payable">Money borrowed ? To pay</option></select></label>
                <label>Original amount (BDT)<input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label>
                <p>Already repaid: {money(entry.paid)}. Repayments are preserved when you save.</p>
                <label>Date<input required type="date" disabled={entry.paid > 0} value={date} onChange={event => setDate(event.target.value)} /></label>
                {entry.paid > 0 && <p>The original date cannot change after a repayment has been recorded.</p>}
                <label>Reason / Purpose<textarea required maxLength={4000} value={reason} onChange={event => setReason(event.target.value)} /></label>
            </>}
            {safety.error && <p role="alert">{safety.error}</p>}
            <button className="primary-button" type="submit">{safety.busy ? 'Saving?' : deleting ? 'Delete entry' : 'Save changes'}</button>
        </fieldset></form>
        <button autoFocus={deleting} type="button" className="outline-button" disabled={safety.busy} onClick={safety.close}>Cancel</button>
    </section></div>;
}
