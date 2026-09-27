import { getBalance, validDate, validateEntry, assertMinor, safeAdd, outgoingMigration, ticketHistory } from './accounting';
import type { Agency, Transaction } from './App';
import type { LedgerSnapshot } from './history';
export type Snapshot = LedgerSnapshot<Agency, Transaction>;
export function validateOpening(agency: Agency, previous: Agency | undefined, entries: Transaction[]) {
    if (agency.openingDate && !validDate(agency.openingDate)) throw Error('Enter a valid opening balance date.');
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if (agency.closedThrough && (agency.closedThrough>today || (agency.openingDate && agency.closedThrough<agency.openingDate))) throw Error('Closing date must be between the opening date and today.');
    if (agency.closedThrough && !validDate(agency.closedThrough)) throw Error('Enter a valid closing date.');
    if (previous?.closedThrough && (!agency.closedThrough || agency.closedThrough < previous.closedThrough)) throw Error('A closed period cannot be reopened or shortened.');
    if (previous && previous.closedThrough && (agency.opening !== previous.opening || agency.openingSide !== previous.openingSide || agency.openingDate !== previous.openingDate)) throw Error('Opening balances are locked after a period is closed. Use a dated correction.');
    if (agency.openingDate && entries.some(t => t.agencyId === agency.id && t.date < agency.openingDate!)) throw Error('Opening date must be on or before the first transaction.');
}
export function assertOpen(agency: Agency | undefined, date: string) {
    if (!agency) throw Error('Agency no longer exists.');
    if (!validDate(date)) throw Error('Enter a valid posting date.');
    if (agency.openingDate && date < agency.openingDate) throw Error('Posting date precedes the opening balance date.');
    if (agency.closedThrough && date <= agency.closedThrough) throw Error(`This agency is closed through ${agency.closedThrough}. Post a correction in an open period.`);
}
export function protectTransaction(snapshot: Snapshot, before: Transaction | null, after: Transaction | null) {
    if (before) {
        if (before.migration) throw Error("Linked migration records cannot be changed individually.");
        if (before.reversalOf || snapshot.transactions.some(t => t.reversalOf === before.id)) throw Error('Reversed entries and reversal entries cannot be edited or deleted.');
        if (before.reconciliation) throw Error('Remove the bank match before editing this receipt.');
        assertOpen(snapshot.agencies.find(a=>a.id===before.agencyId),before.date);
    }
    if (after) assertOpen(snapshot.agencies.find(a=>a.id===after.agencyId),after.date);
}
export function makeReversal(snapshot: Snapshot, original: Transaction, date: string, reason: string, newId: string, timestamp: string): Transaction {
    if (original.migration) throw Error("Linked migration records cannot be reversed individually.");
    if (original.reconciliation) throw Error('Remove the bank match before reversing this receipt.');
    if (typeof reason !== 'string' || !reason.trim()) throw Error('Enter a reason for this reversal.');
    if (reason.trim().length > 1000) throw Error('Reversal reason must be at most 1000 characters.');
    if (original.reversalOf || snapshot.transactions.some(t=>t.reversalOf===original.id)) throw Error('This entry has already been reversed or is a reversal.');
    if (date < original.date) throw Error('A reversal cannot precede its original entry.');
    assertOpen(snapshot.agencies.find(a=>a.id===original.agencyId),date);
    const next: Transaction = {id:newId,agencyId:original.agencyId,type:original.type==='sale'?'payment':'sale',date,voucher:`REV-${newId}`,amount:original.amount,createdAt:timestamp,status:'pending',reversalOf:original.id,narration:`Reversal of ${original.voucher}: ${reason.trim()}`};
    validateEntry(next,snapshot.agencies,snapshot.transactions);
    return next;
}
export function validateMatch(snapshot: Snapshot, tx: Transaction, match: NonNullable<Transaction['reconciliation']>) {
    if (tx.migration) throw Error("Migration credits cannot be matched as receipts.");
    if (tx.type !== 'payment' || tx.reversalOf || snapshot.transactions.some(t=>t.reversalOf===tx.id)) throw Error('Only unreversed payment receipts can be matched.');
    if (!match || typeof match !== 'object' || !validDate(match.date) || typeof match.bankReference !== 'string' || !match.bankReference.trim() || typeof match.bankAccount !== 'string' || !match.bankAccount.trim()) throw Error('Enter the bank account, statement date and reference.');
    if (match.bankReference.length>200 || match.bankAccount.length>200 || Object.keys(match).some(k=>!['date','bankReference','bankAccount','amount'].includes(k))) throw Error('Invalid bank match.');
    assertMinor(match.amount);
    if (match.amount!==tx.amount) throw Error('Bank amount must exactly equal the receipt amount.');
    if (snapshot.transactions.some(t=>t.id!==tx.id && t.reconciliation && t.reconciliation.bankAccount.trim().toLowerCase()===match.bankAccount.trim().toLowerCase() && t.reconciliation.bankReference.trim().toLowerCase()===match.bankReference.trim().toLowerCase())) throw Error('This bank reference is already matched to another receipt.');
}
export function validateBackup(input: unknown): Snapshot {
    if (!input || typeof input !== 'object') throw Error('Select a valid ledger JSON backup.');
    const data=input as Snapshot;
    if (data.version!==2 || !Array.isArray(data.agencies)||!Array.isArray(data.transactions)||!Array.isArray(data.activity)) throw Error('Unsupported or incomplete backup.');
    if (data.agencies.length+data.transactions.length+data.activity.length>400) throw Error('Restore supports up to 400 records including history.');
    if (new TextEncoder().encode(JSON.stringify(data)).length>900000) throw Error('Backup exceeds the 900 KB restore limit.');
    const checkId=(id: unknown)=>{if(typeof id!=='string'|| !/^[A-Za-z0-9_-]{1,100}$/.test(id))throw Error('Backup contains an invalid record ID.');};
    const scalarText=(record:object,fields:string[])=>{const values=record as Record<string,unknown>;for(const key of fields)if(values[key]!==undefined&&(typeof values[key]!=='string'||(values[key] as string).length>4000))throw Error('Invalid backup field: '+key);};
    const ids=new Set<string>(),codes=new Set<string>();
    for(const a of data.agencies){
        if(!a || typeof a!=='object')throw Error('Invalid agency.');checkId(a.id);scalarText(a,['code','name','contact','phone','address','openingDate','closedThrough','archivedAt']);
        if(a.archivedAt&&!Number.isFinite(Date.parse(a.archivedAt)))throw Error('Invalid agency archive date.');
        if(typeof a.code!=='string'||!a.code.trim()||typeof a.name!=='string'||!a.name.trim()||typeof a.active!=='boolean')throw Error('Agency details are incomplete.');
        if(ids.has(a.id)||codes.has(a.code.trim().toLowerCase()))throw Error('Duplicate agencies in backup.');ids.add(a.id);codes.add(a.code.trim().toLowerCase());
        validateOpening(a,undefined,data.transactions);getBalance(a,[]);
    }
    const checked: Transaction[]=[];
    for(const t of data.transactions){
        if(!t || typeof t!=='object')throw Error('Invalid transaction.');checkId(t.id);scalarText(t,['agencyId','voucher','reference','ticket','passenger','sector','flightDate','method','bank','sendingBank','receivingBank','sendingBankName','receivingBankName','chequeNumber','chequeDate','walletNumber','narration','createdAt','archivedAt','reversalOf']);
        if(!['synced','pending','failed'].includes(t.status))throw Error('Invalid transaction status.');
        if(t.archivedAt&&!Number.isFinite(Date.parse(t.archivedAt)))throw Error('Invalid transaction archive date.');
        if((t.flightDate&&!validDate(t.flightDate))||(t.chequeDate&&!validDate(t.chequeDate)))throw Error('Invalid transaction date.');
        if(typeof t.createdAt!=='string'||!Number.isFinite(Date.parse(t.createdAt))||typeof t.voucher!=='string')throw Error('Invalid transaction details.');
        validateEntry(t,data.agencies,checked);checked.push(t);
    }
    for(const t of data.transactions){
        if(t.reversalOf){const original=data.transactions.find(x=>x.id===t.reversalOf);if(!original||original.reversalOf||original.type===t.type||original.agencyId!==t.agencyId||original.amount!==t.amount||t.date<original.date||data.transactions.filter(x=>x.reversalOf===original.id).length!==1)throw Error('Invalid reversal relationship.');}
        if(t.reconciliation)validateMatch(data,t,t.reconciliation);
    }
    for (const t of data.transactions) {
      if (t.nextMigration && (!t.migration || t.migration.saleId !== t.id)) throw Error('Invalid onward migration.');
      for (const m of [t.migration, t.nextMigration]) {
        if (!m) continue;
        if (typeof m !== 'object' || Object.keys(m).some(key=>!['id','sourceId','creditId','saleId','fromAgencyId','toAgencyId','sourcePrice','sellingPrice','createdAt','rootId'].includes(key))) throw Error('Invalid migration metadata.');
        for (const value of [m.id,m.sourceId,m.creditId,m.saleId,m.fromAgencyId,m.toAgencyId]) checkId(value);
        if (m.rootId !== undefined) checkId(m.rootId);
        assertMinor(m.sourcePrice);assertMinor(m.sellingPrice);
        const source=data.transactions.find(x=>x.id===m.sourceId),credit=data.transactions.find(x=>x.id===m.creditId),sale=data.transactions.find(x=>x.id===m.saleId);
        if (!source || !credit || !sale || ![m.sourceId,m.creditId,m.saleId].includes(t.id) || m.creditId!==m.id+'_credit' || m.saleId!==m.id+'_sale' || m.fromAgencyId===m.toAgencyId || !Number.isFinite(Date.parse(m.createdAt))) throw Error('Incomplete migration relationship.');
        if ([source,credit,sale].some(x=>{const link=x.id===m.sourceId?outgoingMigration(x):x.migration;return !link || Object.keys(m).some(key=>(link as Record<string,unknown>)[key] !== (m as unknown as Record<string,unknown>)[key]) || x.archivedAt || x.reversalOf;})) throw Error('Inconsistent migration records.');
        if (source.type!=='sale' || source.agencyId!==m.fromAgencyId || source.amount!==m.sourcePrice || credit.type!=='payment' || credit.agencyId!==m.fromAgencyId || credit.amount!==m.sourcePrice || sale.type!=='sale' || sale.agencyId!==m.toAgencyId || sale.amount!==m.sellingPrice || (m.rootId ? (ticketHistory(source,data.transactions)[0].id!==m.rootId || sale.ticketCost!==ticketHistory(source,data.transactions)[0].ticketCost) : sale.ticketCost!==m.sourcePrice) || credit.date!==sale.date || sale.date<source.date || credit.createdAt!==m.createdAt || sale.createdAt!==m.createdAt) throw Error('Invalid migration amounts or dates.');
      }
    }
    const events=new Set<string>();
    for(const event of data.activity){
        if(!event || typeof event!=='object')throw Error('Invalid activity history.');checkId(event.id);
        if(events.has(event.id)||typeof event.timestamp!=='string'||!Number.isFinite(Date.parse(event.timestamp))||typeof event.label!=='string'||typeof event.actor!=='string'||!['agency','transaction','ledger'].includes(event.entity)||!['create','edit','delete','archive','restore','deactivate','import','reverse','reconcile','unreconcile','close','migrate'].includes(event.action))throw Error('Invalid activity history.');events.add(event.id);
    }
    return JSON.parse(JSON.stringify(data));
}
export function backupTotals(data: Snapshot) {
    return data.agencies.reduce((totals,a)=>{const balance=getBalance(a,data.transactions);return {debit:safeAdd(totals.debit,Math.max(0,balance)),credit:safeAdd(totals.credit,Math.max(0,-balance))};},{debit:0,credit:0});
}
