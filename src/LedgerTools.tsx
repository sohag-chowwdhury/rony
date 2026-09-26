import { useRef, useState } from 'react';
import type { Agency, Transaction } from './App';
import { backupTotals, validateBackup, type Snapshot } from './ledgerControls';
import { balanceMeta, getBalance, parseMoney, validDate } from './accounting';
import { useCloudLedger } from './FirebaseGate';
const amount=(n:number)=>(n/100).toLocaleString('en-BD',{minimumFractionDigits:2,maximumFractionDigits:2});
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function download(data: Snapshot) {
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`ledger-before-restore-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
type Props={snapshot:Snapshot;onRestore:(data:Snapshot,expected:string)=>Promise<void>;onAgency:(a:Agency)=>void|Promise<void>;onReverse:(id:string,date:string,reason:string)=>void|Promise<void>;onMatch:(id:string,match:Transaction['reconciliation']|null)=>void|Promise<void>;initialTab?:string};
export function LedgerTools({snapshot,onRestore,onAgency,onReverse,onMatch,initialTab='restore'}:Props){
 const cloud=useCloudLedger(),[tab,setTab]=useState(initialTab),[busy,setBusy]=useState(false),lock=useRef(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[preview,setPreview]=useState<Snapshot|null>(null),[expected,setExpected]=useState(''),[confirmed,setConfirmed]=useState(false),[backupSaved,setBackupSaved]=useState(false);
 const [agencyId,setAgencyId]=useState(snapshot.agencies[0]?.id||''),[closeDate,setCloseDate]=useState(''),[closeConfirmed,setCloseConfirmed]=useState(false);
 const [entryId,setEntryId]=useState(''),[date,setDate]=useState(today),[reason,setReason]=useState('');
 const [receiptId,setReceiptId]=useState(''),[bankAccount,setBankAccount]=useState(''),[bankReference,setBankReference]=useState(''),[bankDate,setBankDate]=useState(today),[bankAmount,setBankAmount]=useState('');
 const run=async(task:()=>void|Promise<void>,success:string)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await task();setNotice(success);}catch(e){setError(e instanceof Error?e.message:'Unable to save. Review the details and retry.');}finally{lock.current=false;setBusy(false);}};
 const disabled=busy||Boolean(cloud?.busy);
 const eligible=snapshot.transactions.filter(t=>!t.reversalOf&&!snapshot.transactions.some(r=>r.reversalOf===t.id));
 const payments=eligible.filter(t=>t.type==='payment');
 const receipt=payments.find(t=>t.id===receiptId);
 const agency=snapshot.agencies.find(a=>a.id===agencyId);
 const totals=preview?backupTotals(preview):null;
 return <section className="panel controls-panel"><div className="panel-heading"><div><h2>Accounting and recovery</h2><p>Protect history, match receipts and restore validated backups.</p></div></div>
 <div className="tabs">{[['match','Bank matching'],['reverse','Corrections'],['close','Close periods'],['restore','Restore backup']].map(([key,label])=><button key={key} disabled={disabled} className={tab===key?'active':''} onClick={()=>{setTab(key);setError('');setNotice('');}}>{label}</button>)}</div>
 {error&&<p className="auth-error" role="alert">{error}</p>}{notice&&<p className="save-status" role="status">{notice}</p>}{busy&&<p role="status">Saving… Keep this page open.</p>}
 <fieldset disabled={disabled} className="controls-fields">
 {tab==='restore'&&<>
 <h3>Restore a JSON ledger backup</h3><p>Preview the file, download a copy of your current ledger, then confirm replacement. Existing activity history is retained. A recovery copy is saved before replacement. Closed periods cannot be overwritten.</p>
 <button className="outline-button" onClick={()=>void run(async()=>{
    const data=cloud ? await cloud.recovery() : JSON.parse(localStorage.getItem("aegis-pre-restore-backup")||"null");
    if(!data)throw Error('No pre-restore recovery copy is available.');download(data);
 },'Recovery copy downloaded. Preview this JSON file to restore it.')}>Download latest recovery copy</button>
 <label className="field">Backup file<input type="file" accept=".json,application/json" onChange={async e=>{const file=e.target.files?.[0];setPreview(null);setConfirmed(false);setBackupSaved(false);setError('');if(!file)return;try{if(file.size>900000)throw Error('Choose a backup no larger than 900 KB.');const data=validateBackup(JSON.parse(await file.text()));setPreview(data);setExpected(JSON.stringify(snapshot));}catch(err){setError(err instanceof Error?err.message:'Invalid backup.');}}}/></label>
 {preview&&<div className="restore-preview"><h4>Replacement preview</h4><table><thead><tr><th>Records</th><th>Current</th><th>Backup</th></tr></thead><tbody>{(['agencies','transactions','activity'] as const).map(key=><tr key={key}><td>{key}</td><td>{snapshot[key].length}</td><td>{preview[key].length}</td></tr>)}</tbody></table><p>Backup balances: BDT {amount(totals!.debit)} Dr receivable · BDT {amount(totals!.credit)} Cr advance</p>
 <button className="outline-button" onClick={()=>{download(snapshot);setBackupSaved(true);}}>Download current ledger before restore</button>
 <label className="confirmation"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Replace current agencies and transactions with this backup.</label>
 <button className="primary-button" disabled={!confirmed||!backupSaved} onClick={()=>void run(async()=>{await onRestore(preview,expected);setPreview(null);setConfirmed(false);},'Backup restored. Records and history are saved.')}>Restore confirmed backup</button></div>}
 </>}
 {tab==='close'&&<><h3>Close an agency accounting period</h3><p>Financial entries dated on or before this date and opening balances become locked. Corrections must be posted in a later open period. Closing cannot be undone.</p>
 <label className="field">Agency<select aria-label="Agency" value={agencyId} onChange={e=>{setAgencyId(e.target.value);setCloseConfirmed(false);}}><option value="">Select agency</option>{snapshot.agencies.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
 {agency&&<p>Closed through: {agency.closedThrough||'Not closed'} · Opening date: {agency.openingDate||'Legacy undated opening'} · Balance: BDT {amount(Math.abs(getBalance(agency,snapshot.transactions)))} {balanceMeta(getBalance(agency,snapshot.transactions)).side}</p>}
 <label className="field">Close through<input type="date" max={today()} value={closeDate} onChange={e=>{setCloseDate(e.target.value);setCloseConfirmed(false);}}/></label>
 <label className="confirmation"><input type="checkbox" checked={closeConfirmed} onChange={e=>setCloseConfirmed(e.target.checked)}/> I have reconciled this period and want to lock it.</label>
 <button className="primary-button" disabled={!agency||!closeConfirmed} onClick={()=>void run(async()=>{if(!validDate(closeDate)||closeDate>today())throw Error('Choose a valid date no later than today.');await onAgency({...agency!,closedThrough:closeDate});setCloseConfirmed(false);},'Period closed. Historical financial changes are blocked.')}>Close period</button>
 </>}
 {tab==='reverse'&&<><h3>Reverse an incorrect entry</h3><p>The original stays in history. An equal opposite entry posts on the selected open-period date. Enter a corrected sale or payment separately when needed.</p>
 <label className="field">Original entry<select aria-label="Original entry" value={entryId} onChange={e=>setEntryId(e.target.value)}><option value="">Select entry</option>{eligible.map(t=><option key={t.id} value={t.id}>{t.voucher} · {snapshot.agencies.find(a=>a.id===t.agencyId)?.name} · {t.type} · {amount(t.amount)}</option>)}</select></label>
 <label className="field">Reversal date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label className="field">Reason<input value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)}/></label>
 <button className="primary-button" disabled={!entryId||!reason.trim()} onClick={()=>void run(async()=>{await onReverse(entryId,date,reason);setEntryId('');setReason('');},'Reversal saved. The original entry remains unchanged.')}>Post reversal</button>
 </>}
 {tab==='match'&&<><h3>Match payment receipts to bank records</h3><p>Match one receipt to one bank statement reference. The bank amount must equal the receipt amount. Matching changes no ledger balances.</p>
 <p>{payments.filter(t=>t.reconciliation).length} matched · {payments.filter(t=>!t.reconciliation).length} unmatched receipts</p>
 <label className="field">Payment receipt<select aria-label="Payment receipt" value={receiptId} onChange={e=>{setReceiptId(e.target.value);setBankAmount('');setBankReference('');}}><option value="">Select receipt</option>{payments.map(t=><option key={t.id} value={t.id}>{t.voucher} · {amount(t.amount)} · {t.reconciliation?'Matched':'Unmatched'}</option>)}</select></label>
 {receipt&&<p>Receipt amount: BDT {amount(receipt.amount)} · {snapshot.agencies.find(a=>a.id===receipt.agencyId)?.name}</p>}
 {receipt?.reconciliation?<><p>Matched to {receipt.reconciliation.bankAccount} · {receipt.reconciliation.bankReference} · {receipt.reconciliation.date} · BDT {amount(receipt.reconciliation.amount)}</p><button className="outline-button" onClick={()=>void run(()=>onMatch(receipt.id,null),'Bank match removed. Ledger balances are unchanged.')}>Remove bank match</button></>:<><div className="form-grid"><label className="field">Bank account<input value={bankAccount} maxLength={200} onChange={e=>setBankAccount(e.target.value)} placeholder="Bank name / account ending"/></label><label className="field">Bank statement reference<input value={bankReference} maxLength={200} onChange={e=>setBankReference(e.target.value)}/></label><label className="field">Bank statement date<input type="date" value={bankDate} onChange={e=>setBankDate(e.target.value)}/></label><label className="field">Bank amount (BDT)<input inputMode="decimal" value={bankAmount} onChange={e=>setBankAmount(e.target.value)}/></label></div>
 <button className="primary-button" disabled={!receipt} onClick={()=>void run(()=>onMatch(receiptId,{bankAccount:bankAccount.trim(),bankReference:bankReference.trim(),date:bankDate,amount:parseMoney(bankAmount)}),'Receipt matched. Ledger balances are unchanged.')}>Match receipt</button></>}
 <div className="reconciliation-table"><table><thead><tr><th>Receipt</th><th>Agency</th><th>Amount</th><th>Bank reference</th></tr></thead><tbody>{payments.map(t=><tr key={t.id}><td>{t.voucher}</td><td>{snapshot.agencies.find(a=>a.id===t.agencyId)?.name}</td><td>{amount(t.amount)}</td><td>{t.reconciliation?`${t.reconciliation.bankAccount} / ${t.reconciliation.bankReference}`:'Unmatched'}</td></tr>)}</tbody></table></div>
 </>}
 </fieldset></section>;
}
