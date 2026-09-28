import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Wallet, Plus, Search, ShieldCheck, Pencil, Trash2, History, BookOpen, Download } from 'lucide-react';
import { collection, doc, getDocsFromServer, onSnapshot, runTransaction, setDoc } from 'firebase/firestore';
import { firebaseServices } from './firebase';
import { parseMoney } from './accounting';
import { useFormSafety } from './useFormSafety';
import { applyPersonalPayment, editPersonalEntry, PERSONAL_STORAGE_KEY, personalTotals, validatePersonalEntry, type PersonalEntry, type PersonalPayment } from './personalAccounting';
import './personal-ledger.css';
import { createPersonalLedgerPdf, personalPdfEntries } from './personalLedgerPdf';

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
    const [page, setPage] = useState(1);
    const [historyEntry, setHistoryEntry] = useState<PersonalEntry | null>(null);
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
    const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState('');
    const totals = personalTotals(data.entries);
    async function downloadPdf(person?: string) {
        if (exporting || loading || error) return;
        setExporting(true); setExportError('');
        try {
            const name = person === undefined ? 'full' : person.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 80);
            let report: LocalData;
            if (services && uid) {
                const snapshot = await getDocsFromServer(collection(services.db, 'personalLedgers', uid, 'entries'));
                const reportEntries = personalPdfEntries(snapshot.docs.map(item => item.data() as PersonalEntry), person);
                const histories = await Promise.all(reportEntries.map(async entry => {
                    const history = await getDocsFromServer(collection(services.db, 'personalLedgers', uid, 'entries', entry.id, 'payments'));
                    return [entry.id, history.docs.map(item => item.data() as PersonalPayment)] as const;
                }));
                report = { entries: reportEntries, payments: Object.fromEntries(histories) };
            } else {
                report = readLocal();
            }
            for (const entry of personalPdfEntries(report.entries, person)) {
                const repaid = (report.payments[entry.id] || []).reduce((sum, payment) => sum + payment.amount, 0);
                if (repaid !== entry.paid) throw Error('Repayment history does not match the current balance. Refresh and try downloading again.');
            }
            await createPersonalLedgerPdf(report.entries, person, report.payments).save(`personal-ledger-${name}-${today()}.pdf`, { returnPromise: true });
        } catch (reason) { setExportError(reason instanceof Error ? reason.message : 'Unable to download PDF. Please try again.'); }
        finally { setExporting(false); }
    }
    const entries = data.entries.filter(entry => !entry.deleted).filter(entry => `${entry.person} ${entry.reason}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const pageSize = 50;
    const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
    const currentPage = Math.min(page, pageCount);
    const pageStart = (currentPage - 1) * pageSize;
    const shownEntries = entries.slice(pageStart, pageStart + pageSize);
    useEffect(() => { setPage(current => Math.min(current, pageCount)); }, [pageCount]);
    return <section className="personal-ledger">
        <header className="personal-header"><div className="personal-title"><span className="personal-icon"><Wallet size={24} aria-hidden="true" /></span><div><span className="personal-eyebrow">YOUR PERSONAL ACCOUNTS</span><h1>Personal ledger</h1><p>A clear view of what you lend, borrow, and repay.</p></div></div><button className="primary-button" disabled={loading || !!error} onClick={() => setForm('new')}><Plus size={17} aria-hidden="true" /> Add personal entry</button></header>
        <div className="personal-totals">{(['receivable', 'payable'] as const).map(direction => <article key={direction} className={`panel personal-total ${direction}`}><div className="personal-total-label"><span>{direction === 'receivable' ? 'To receive' : 'To pay'}</span><span className="personal-icon">{direction === 'receivable' ? <ArrowDownLeft size={22} aria-hidden="true" /> : <ArrowUpRight size={22} aria-hidden="true" />}</span></div><h2>{loading || error ? '—' : money(totals[direction])}</h2><p>{direction === 'receivable' ? 'Outstanding money you lent' : 'Outstanding money you borrowed'}</p></article>)}</div>
        <p className="personal-help"><ShieldCheck size={17} aria-hidden="true" /><span>{services ? 'Personal records are saved privately to your signed-in account.' : 'Personal records are saved in this browser.'} Business reports and backups do not include these records.</span></p>
        {error && <p role="alert">Unable to load personal records: {error}</p>}
        <div className="personal-exports" aria-label="Download personal ledger PDF">
            <button className="outline-button" disabled={loading || !!error || exporting || !data.entries.some(entry => !entry.deleted)} onClick={() => void downloadPdf()}><Download size={16} aria-hidden="true" /> Full PDF</button>
            {exporting && <span role="status">Preparing PDF...</span>}
        </div>
        {exportError && <p role="alert">{exportError}</p>}
        <div className="panel personal-records"><div className="personal-toolbar"><div><h2>All entries <span className="personal-count">{entries.length}</span></h2><p>Your loans and repayment activity</p></div><label className="personal-search"><Search size={17} aria-hidden="true" /><input aria-label="Search person or reason" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search person or reason…" /></label></div>
        {loading ? <p className="personal-empty" role="status">Loading personal records…</p> : !error && <div className="personal-table"><table><thead><tr><th scope="col">Date / Person</th><th scope="col">Reason / Purpose</th><th scope="col">Type</th><th scope="col">Original</th><th scope="col">Repaid</th><th scope="col">Outstanding</th><th scope="col">Actions</th></tr></thead><tbody>
            {shownEntries.map(entry => <tr key={entry.id}><td data-label="Person"><div className="personal-person"><span className="personal-avatar" aria-hidden="true">{entry.person.trim().slice(0, 1).toUpperCase()}</span><div><strong>{entry.person}</strong>{entry.contactNumber && <small>{entry.contactNumber}</small>}<small>{entry.date}</small></div></div></td><td data-label="Purpose" className="personal-reason">{entry.reason}</td><td data-label="Type"><span className={`personal-badge ${entry.direction}`}>{entry.direction === 'receivable' ? <ArrowDownLeft size={13} aria-hidden="true" /> : <ArrowUpRight size={13} aria-hidden="true" />}{entry.direction === 'receivable' ? 'To receive' : 'To pay'}</span></td><td data-label="Original" className="personal-money">{money(entry.amount)}</td><td data-label="Repaid" className="personal-money">{money(entry.paid)}</td><td data-label="Outstanding" className="personal-balance"><strong>{money(entry.amount - entry.paid)}</strong><div className="personal-progress" aria-hidden="true"><span style={{ width: `${entry.paid / entry.amount * 100}%` }} /></div><small>{entry.paid === entry.amount ? 'Settled' : `${Math.round(entry.paid / entry.amount * 100)}% repaid`}</small></td><td data-label="Actions"><div className="personal-actions"><button className="outline-button" disabled={loading || !!error || exporting} aria-label={`Download PDF for ${entry.person}`} onClick={() => void downloadPdf(entry.person)}><Download size={14} aria-hidden="true" />Download PDF</button><button className="outline-button personal-history" onClick={() => setHistoryEntry(entry)}><History size={14} aria-hidden="true" />History</button>{entry.paid < entry.amount && <button className="outline-button personal-payment" onClick={() => setForm(entry)}>{entry.direction === 'receivable' ? <ArrowDownLeft size={14} aria-hidden="true" /> : <ArrowUpRight size={14} aria-hidden="true" />}{entry.direction === 'receivable' ? 'Receive' : 'Pay / Repay'}</button>}<button className="outline-button" aria-label={`Edit entry for ${entry.person}`} title="Edit entry" onClick={() => setManage({ entry, deleting: false })}><Pencil size={15} aria-hidden="true" /></button><button className="outline-button personal-delete" aria-label={`Delete entry for ${entry.person}`} title="Delete entry" onClick={() => setManage({ entry, deleting: true })}><Trash2 size={15} aria-hidden="true" /></button></div></td></tr>)}
            {!entries.length && <tr><td colSpan={7}><div className="personal-empty"><BookOpen size={30} aria-hidden="true" /><h3>{query ? 'No matching entries' : 'Start your personal ledger'}</h3><p>{query ? 'Try another name or reason.' : 'Add money you lent or borrowed to keep every balance in view.'}</p>{query && <button className="outline-button" onClick={() => { setQuery(''); setPage(1); }}>Clear search</button>}</div></td></tr>}
        </tbody></table></div>}
        {!loading && !error && entries.length > 0 && <nav className="pagination personal-pagination" aria-label="Personal ledger pagination">
            <span role="status">Showing {pageStart + 1}-{Math.min(pageStart + pageSize, entries.length)} of {entries.length} entries</span>
            <div className="personal-page-controls">
                <button className="outline-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
                <span>Page {currentPage} of {pageCount}</span>
                <button className="outline-button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
            </div>
        </nav>}</div>
        {historyEntry && <PersonalHistory key={historyEntry.id} entry={data.entries.find(item => item.id === historyEntry.id) || historyEntry} payments={data.payments[historyEntry.id] || []} onClose={() => setHistoryEntry(null)} />}
        {manage && <ManagePersonalEntry key={`${manage.entry.id}-${manage.deleting}`} entry={manage.entry} deleting={manage.deleting} onClose={() => setManage(null)} onSave={changeEntry} />}
        {form && <PersonalForm key={typeof form === 'string' ? 'new' : form.id} entry={form === 'new' ? null : data.entries.find(item => item.id === form.id) || form} onClose={() => setForm(null)} onSave={save} />}
    </section>;
}
function PersonalHistory({ entry, payments, onClose }: { entry: PersonalEntry; payments: PersonalPayment[]; onClose: () => void }) {
    const services = firebaseServices, uid = services?.auth.currentUser?.uid;
    const [history, setHistory] = useState(payments), [historyError, setHistoryError] = useState('');
    const [loading, setLoading] = useState(Boolean(services && uid));
    useEffect(() => {
        if (services && uid) return onSnapshot(collection(services.db, 'personalLedgers', uid, 'entries', entry.id, 'payments'), result => {
            setHistory(result.docs.map(item => item.data() as PersonalPayment));
            setHistoryError(''); setLoading(false);
        }, error => { setHistoryError(error.message); setLoading(false); });
        setHistory(payments); setLoading(false);
    }, [entry.id, services, uid, payments]);
    return <div className="modal-backdrop"><section className="personal-dialog panel" role="dialog" aria-modal="true" aria-labelledby="personal-history-title">
        <div className="personal-dialog-heading"><span className="personal-icon"><History size={18} aria-hidden="true" /></span><div><h2 id="personal-history-title">Repayment history</h2><p>{entry.person}</p></div></div>
        <p className="personal-dialog-reason">{entry.reason}</p>
        <section className="personal-history-section">
            {loading ? <p role="status">Loading repayments...</p> : historyError ? <p role="alert">{historyError}</p> : <>
                <div className="personal-history-heading"><h3>{entry.direction === 'receivable' ? 'Money received' : 'Payments made'}</h3><span>{history.length} payments</span></div>
                {!history.length ? <p className="personal-history-empty">No repayments recorded yet.</p> : <ul className="personal-history-list">{[...history].sort((a, b) => b.date.localeCompare(a.date)).map(item => <li key={item.id}><span className="personal-history-dot" aria-hidden="true" /><div><time dateTime={item.date}>{item.date}</time>{item.note && <p>{item.note}</p>}</div><strong>{money(item.amount)}</strong></li>)}</ul>}
            </>}
        </section>
        <button autoFocus type="button" className="outline-button" onClick={onClose}>Close</button>
    </section></div>;
}
function PersonalForm({ entry, onClose, onSave }: { entry: PersonalEntry | null; onClose: () => void; onSave: (entry: PersonalEntry, payment?: PersonalPayment) => Promise<void> }) {
    const [person, setPerson] = useState(''), [direction, setDirection] = useState<PersonalEntry['direction']>('receivable'), [amount, setAmount] = useState(''), [date, setDate] = useState(today), [reason, setReason] = useState('');
    const [contactNumber, setContactNumber] = useState(entry?.contactNumber || '');
    const safety = useFormSafety({ person, contactNumber, direction, amount, date, reason }, onClose);
    return <div className="modal-backdrop"><section className={`personal-dialog panel${entry ? ' personal-repayment-dialog' : ''}`} role="dialog" aria-modal="true" aria-labelledby="personal-form-title">
        <div className="personal-dialog-heading"><span className="personal-icon"><History size={18} aria-hidden="true" /></span><div><h2 id="personal-form-title">{entry ? (entry.direction === 'receivable' ? 'Receive repayment' : 'Pay / Repay') : 'Add personal entry'}</h2>{entry && <p>{entry.person}</p>}</div></div>
        {entry && <>
            <p className="personal-dialog-reason">{entry.reason}</p>
            <div className={`personal-repayment-summary ${entry.direction}`}>
                <div className="personal-due"><span>{entry.direction === 'receivable' ? <ArrowDownLeft size={16} aria-hidden="true" /> : <ArrowUpRight size={16} aria-hidden="true" />}{entry.direction === 'receivable' ? 'You will receive' : 'You need to pay'}</span><strong>{money(entry.amount - entry.paid)}</strong><small>{entry.paid === entry.amount ? 'Fully settled' : entry.direction === 'receivable' ? 'Remaining to collect from this person' : 'Remaining to pay this person'}</small></div>
                <dl className="personal-repayment-breakdown"><div><dt>{entry.direction === 'receivable' ? 'Total lent' : 'Total borrowed'}</dt><dd>{money(entry.amount)}</dd></div><div><dt>{entry.direction === 'receivable' ? 'Already received' : 'Already paid'}</dt><dd>{money(entry.paid)}</dd></div></dl>
            </div>
            {entry.paid < entry.amount && <h3 className="personal-repayment-form-title">{entry.direction === 'receivable' ? 'Record money received' : 'Record a payment'}</h3>}
        </>}
        {(!entry || entry.paid < entry.amount) && <form onSubmit={async event => {
            event.preventDefault(); if (!safety.start()) return;
            try {
                const value = parseMoney(amount);
                if (entry) await onSave(entry, { id: crypto.randomUUID(), amount: value, date, note: reason.trim() });
                else await onSave({ id: crypto.randomUUID(), person: person.trim(), contactNumber: contactNumber.trim(), direction, amount: value, paid: 0, date, reason: reason.trim(), createdAt: new Date().toISOString() });
                onClose();
            } catch (error) { safety.fail(error); } finally { safety.finish(); }
        }}><fieldset disabled={safety.busy}>
            {!entry && <><label>Person name<input autoFocus required maxLength={200} value={person} onChange={event => setPerson(event.target.value)} /></label><label>Contact number (optional)<input type="tel" autoComplete="tel" maxLength={40} value={contactNumber} onChange={event => setContactNumber(event.target.value)} /></label><label>Entry type<select value={direction} onChange={event => setDirection(event.target.value as PersonalEntry['direction'])}><option value="receivable">Money lent — To receive</option><option value="payable">Money borrowed — To pay</option></select></label></>}
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
    const [contactNumber, setContactNumber] = useState(entry?.contactNumber || '');
    const safety = useFormSafety({ person, contactNumber, direction, amount, date, reason }, onClose);
    return <div className="modal-backdrop"><section className="personal-dialog panel" role="dialog" aria-modal="true" aria-labelledby="personal-manage-title">
        <h2 id="personal-manage-title">{deleting ? 'Delete personal entry?' : 'Edit personal entry'}</h2>
        {deleting && <p>Delete the entry for <strong>{entry.person}</strong> ({money(entry.amount)})? It will be removed from your list and outstanding totals. Its repayment history will be kept.</p>}
        <form onSubmit={async event => {
            event.preventDefault();
            if (!safety.start()) return;
            try {
                await onSave(deleting ? entry : { ...entry, person: person.trim(), contactNumber: contactNumber.trim(), direction, amount: parseMoney(amount), date, reason: reason.trim() }, deleting);
                onClose();
            } catch (error) { safety.fail(error); } finally { safety.finish(); }
        }}><fieldset disabled={safety.busy}>
            {!deleting && <>
                <label>Person name<input autoFocus required maxLength={200} value={person} onChange={event => setPerson(event.target.value)} /></label><label>Contact number (optional)<input type="tel" autoComplete="tel" maxLength={40} value={contactNumber} onChange={event => setContactNumber(event.target.value)} /></label>
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
