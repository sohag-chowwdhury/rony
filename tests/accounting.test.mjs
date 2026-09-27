import * as controls from '../src/shared/ledgerControls.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transformWithOxc } from 'vite';
const source = await fs.readFile(new URL('../src/accounting.ts', import.meta.url), 'utf8');
const { code } = await transformWithOxc(source, 'accounting.ts');
const { parseMoney, getBalance, balanceMeta, calculateLedger, validateEntry, amountInWords, validDate, canDeleteAgency, safeAdd } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const account = { id: 'a', opening: 10000, openingSide: 'Dr' };
const entry = (id, type, amount, date = '2026-09-20', agencyId = 'a') => ({ id, type, amount, date, agencyId, voucher: id, createdAt: `${date}T12:00:00Z` });
test('decimal input converts exactly into minor units', () => {
  for (const [input, expected] of [['0.01',1],['1.15',115],['19.99',1999],['100000.25',10000025],[' 12.5 ',1250]]) assert.equal(parseMoney(input),expected);
  assert.equal(parseMoney('0',true),0);
});
test('reject negative, zero, invalid, excessive precision and unsafe amounts', () => {
  for (const input of ['-1','0','0.00','','NaN','Infinity','1e3','1.005','12abc','9,000','90071992547409.92']) assert.throws(()=>parseMoney(input),undefined,input);
});
test('sales debit and payments credit; other agencies excluded', () => {
  assert.equal(getBalance(account,[entry('s','sale',5000),entry('p','payment',3000),entry('x','sale',9999,'2026-09-20','other')]),12000);
});
test('exact settlement gives zero, not Dr or Cr', () => {
  assert.deepEqual(balanceMeta(getBalance(account,[entry('p','payment',10000)])),{value:0,side:'—'});
});
test('overpayment creates Cr',()=>assert.deepEqual(balanceMeta(getBalance(account,[entry('p','payment',15000)])),{value:5000,side:'Cr'}));
test('credit opening offsets future sale',()=>assert.equal(getBalance({...account,openingSide:'Cr'},[entry('s','sale',15000)]),5000));
test('period opening includes earlier entries and excludes later entries',()=>{
  const result=calculateLedger(account,[entry('late','sale',9999,'2026-10-01'),entry('p','payment',3000,'2026-09-22'),entry('old','sale',5000,'2026-08-31'),entry('s','sale',2000,'2026-09-01')],'2026-09-01','2026-09-30');
  assert.equal(result.opening,15000); assert.equal(result.closing,14000);
  assert.equal(result.totalDebit,2000); assert.equal(result.totalCredit,3000);
  assert.deepEqual(result.rows.map(r=>[r.t.id,r.running]),[['s',17000],['p',14000]]);
});
test('same-day order is deterministic even when timestamps tie',()=>{
  const result=calculateLedger({...account,opening:0},[entry('b','sale',700),entry('a','payment',500)],'2026-09-20','2026-09-20');
  assert.deepEqual(result.rows.map(r=>r.running),[-500,200]);
});
test('editing payment changes balance and deleting it reverses its effect',()=>{
  const sale=entry('s','sale',5000), payment=entry('p','payment',3000);
  assert.equal(getBalance(account,[sale,payment]),12000);
  assert.equal(getBalance(account,[sale,{...payment,amount:7000}]),8000);
  assert.equal(getBalance(account,[sale]),15000);
});
test('moving an entry recalculates both agencies',()=>{
  const other={...account,id:'b',opening:0};
  const moved=entry('s','sale',5000,'2026-09-20','b');
  assert.equal(getBalance(account,[moved]),10000); assert.equal(getBalance(other,[moved]),5000);
});
test('empty period retains opening balance',()=>{
  const result=calculateLedger(account,[],'2026-09-01','2026-09-30');
  assert.equal(result.closing,10000);assert.deepEqual(result.rows,[]);
});
test('invalid dates and reversed ranges rejected',()=>{
  for(const date of ['2026-02-30','','2026-13-01','abc']) assert.equal(validDate(date),false);
  assert.throws(()=>calculateLedger(account,[],'2026-09-30','2026-09-01'));
});
test('duplicate voucher and double submission blocked',()=>{
  const existing=entry('s','sale',100);
  assert.throws(()=>validateEntry({...existing,id:'other',voucher:' S '},[account],[existing]));
  assert.throws(()=>validateEntry(existing,[account],[existing]));
  assert.doesNotThrow(()=>validateEntry({...existing,amount:200},[account],[existing],true));
});
test('unknown agencies, missing edits and invalid monetary records rejected',()=>{
  assert.throws(()=>validateEntry(entry('x','sale',100,'2026-09-20','missing'),[account],[]));
  assert.throws(()=>validateEntry(entry('x','sale',100),[account],[],true));
  for(const amount of [-1,0,NaN,Infinity,1.5]) assert.throws(()=>validateEntry(entry('x','sale',amount),[account],[]));
});
test('agency with opening balance or history cannot be deleted',()=>{
  assert.equal(canDeleteAgency(account,[]),false);
  assert.equal(canDeleteAgency({...account,opening:0},[entry('s','sale',1)]),false);
  assert.equal(canDeleteAgency({...account,opening:0},[]),true);
});
test('receipt words include paisa and support large values',()=>{
  assert.equal(amountInWords(1),'Zero Taka and One Paisa only');
  assert.equal(amountInWords(115),'One Taka and Fifteen Paisa only');
  assert.equal(amountInWords(5000000),'Fifty Thousand Taka only');
  assert.equal(amountInWords(0),'Zero Taka only');
  assert(!amountInWords(1000000000000).includes('undefined'));
});
test('unsafe balance totals are rejected',()=>assert.throws(()=>safeAdd(Number.MAX_SAFE_INTEGER,1)));
test('many small movements maintain the reconciliation invariant',()=>{
  const rows=Array.from({length:1000},(_,i)=>entry(String(i),i%3?'sale':'payment',i+1));
  const result=calculateLedger(account,rows,'2026-09-01','2026-09-30');
  assert.equal(result.closing,result.opening+result.totalDebit-result.totalCredit);
  assert.equal(result.closing,getBalance(account,rows));
});

const appSource = await fs.readFile(new URL('../src/App.tsx', import.meta.url),'utf8');
const hookSource = appSource.slice(appSource.indexOf('function useLedgerStore()'),appSource.indexOf('const navItems:'));
const hookCode = (await transformWithOxc(hookSource,'store.ts')).code;
const core = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const historySource = await fs.readFile(new URL('../src/history.ts', import.meta.url),'utf8');
const historyCode = (await transformWithOxc(historySource,'history.ts')).code;
const history = await import(`data:text/javascript;base64,${Buffer.from(historyCode).toString('base64')}`);
const comparisonSource = await fs.readFile(new URL('../src/recordComparison.ts', import.meta.url), 'utf8');
const comparisonCode = (await transformWithOxc(comparisonSource, 'recordComparison.ts')).code;
const comparison = await import('data:text/javascript;base64,' + Buffer.from(comparisonCode).toString('base64'));
function storeHarness(cloud = null) {
  const data = new Map(); let fail = false; const updates=[];
  const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>{if(fail)throw Error('Storage quota exceeded');data.set(key,value);}};
  const make = new Function('useState','useRef','useEffect','localStorage','demoAgencies','demoTransactions','validateEntry','assertMinor','getBalance','canDeleteAgency','readLedgerSnapshot','persistLedger','makeAuditEvent','changeArchive','LEDGER_STORAGE_KEY','useCloudLedger','mergeAgencyEdit','sameRecord','validateOpening','protectTransaction','makeReversal','validateMatch','validateBackup',hookCode+'; return useLedgerStore();');
  const store=make(initial=>[typeof initial==='function'?initial():initial,next=>updates.push(next)],value=>({current:value}),()=>{},storage,[{...account,code:'A',name:'Agency A',active:true}],[],core.validateEntry,core.assertMinor,core.getBalance,core.canDeleteAgency,history.readLedgerSnapshot,history.persistLedger,history.makeAuditEvent,history.changeArchive,history.LEDGER_STORAGE_KEY,()=>cloud,comparison.mergeAgencyEdit,comparison.sameRecord,controls.validateOpening,controls.protectTransaction,controls.makeReversal,controls.validateMatch,controls.validateBackup);
  return {store,storage,updates,fail:()=>{fail=true;},snapshot:()=>history.readLedgerSnapshot(storage,[account],[]),transactions:()=>history.readLedgerSnapshot(storage,[account],[]).transactions};
}
test('store blocks immediate double submission and duplicate vouchers',()=>{
  const h=storeHarness(),t=entry('s','sale',100);
  h.store.add(t);assert.throws(()=>h.store.add(t));
  assert.throws(()=>h.store.add({...t,id:'new'}));assert.equal(h.transactions().length,1);
});
test('storage failure does not commit UI state or report success',()=>{
  const h=storeHarness();h.fail();assert.throws(()=>h.store.add(entry('s','sale',100)));
  assert.equal(h.updates.length,0);assert.equal(h.transactions().length,0);
});
test('store persists edits and archive keeps the record recoverable',()=>{
  const h=storeHarness(),t=entry('s','sale',100);h.store.add(t);
  h.store.updateTransaction({...t,amount:200,status:'synced'});
  assert.equal(h.transactions()[0].amount,200);assert.equal(h.transactions()[0].status,'pending');
  h.store.deleteTransaction(t.id);assert.equal(h.transactions().length,1);assert(h.transactions()[0].archivedAt);assert.equal(getBalance(account,h.transactions()),10200);
});
test('store refuses stale-tab overwrite',()=>{
  const h=storeHarness();h.storage.setItem('aegis-transactions',JSON.stringify([entry('other','sale',900)]));
  assert.throws(()=>h.store.add(entry('s','sale',100)),/another tab/);
  assert.equal(h.transactions()[0].id,'other');
});
test('store rejects negative opening and preserves funds when archiving an agency',()=>{
  const h=storeHarness();assert.throws(()=>h.store.updateAgency({...account,opening:-1,code:'A',name:'Agency A'}));
  assert.equal(h.updates.length,0);h.store.deleteAgency('a');assert(h.snapshot().agencies[0].archivedAt);assert.equal(getBalance(h.snapshot().agencies[0],[]),10000);
});
const pdfSource = await fs.readFile(new URL('../src/LedgerStatement.tsx',import.meta.url),'utf8');
const pdfCode = (await transformWithOxc(pdfSource,'LedgerStatement.tsx')).code.replace('"jspdf"',JSON.stringify(import.meta.resolve('jspdf')));
const {createLedgerPdf}=await import(`data:text/javascript;base64,${Buffer.from(pdfCode).toString('base64')}`);
test('PDF preserves debit/credit numbers, zero side and page totals across pages',()=>{
  const data={account:'A Test Agency',from:'2026-09-01',to:'2026-09-30',opening:0,rows:Array.from({length:70},(_,i)=>({date:'2026-09-20',voucher:`V-${i}`,narration:'Payment and ticket reconciliation test',method:'Cash',debit:i%2?12345:0,credit:i%2?0:12345,balance:i%2?0:-12345}))};
  const pdf=createLedgerPdf(data),output=pdf.output();
  assert(pdf.getNumberOfPages()>1);assert(output.includes('(123.45 Cr)'));assert(output.includes('(0.00 -)'));
  for(let i=0;i<70;i++) assert(output.includes(`(V-${i})`));
  for(let i=1;i<=pdf.getNumberOfPages();i++)assert(output.includes(`(Page ${i} of ${pdf.getNumberOfPages()})`));
});

test('ticket and payment forms use strict decimal parsing before saving', async()=>{
  for(const name of ['SaleForm','PaymentForm']) {
    const start=appSource.indexOf(`function ${name}(`);
    const end=appSource.indexOf('\nfunction ',start+1);
    const form=appSource.slice(start,end);
    assert(form.includes('amount: parseMoney(data.amount)'));
    assert(!form.includes('Math.round(Number(data.amount)'));
    assert(form.includes('catch (error)'));
  }
});

test('archive and restore keep totals and preserve transaction identity across reload',()=>{
  const h=storeHarness(),sale=entry('s','sale',15000),payment=entry('p','payment',7000);
  h.store.add(sale);h.store.add(payment);
  const original=getBalance(account,h.transactions());
  h.store.setArchived('s',true);h.store.setArchived('p',true);
  const saved=h.snapshot();assert.equal(saved.transactions.filter(t=>t.archivedAt).length,2);
  assert.equal(getBalance(account,saved.transactions),original);
  assert.equal(calculateLedger(account,saved.transactions,'2026-09-01','2026-09-30').totalCredit,7000);
  h.store.setArchived('s',false);h.store.setArchived('p',false);
  assert.equal(h.transactions().length,2);assert.equal(h.transactions().filter(t=>t.archivedAt).length,0);
  assert.equal(getBalance(account,h.transactions()),original);
  assert.deepEqual(h.snapshot().activity.map(e=>e.action),['create','create','archive','archive','restore','restore']);
});
test('audit captures immutable before/after, date/time and deleted record',()=>{
  const h=storeHarness(),t=entry('s','sale',100);h.store.add(t);
  h.store.updateTransaction({...t,amount:250,date:'2026-09-21'});h.store.deleteTransaction('s');
  const log=h.snapshot().activity;
  assert.equal(log[1].before.amount,100);assert.equal(log[1].after.amount,250);
  assert.equal(log[1].before.date,'2026-09-20');assert.equal(log[1].after.date,'2026-09-21');
  assert.equal(log[2].before.amount,250);assert.equal(log[2].after.amount,250);assert(log[2].after.archivedAt);
  assert(log.every(e=>Number.isFinite(Date.parse(e.timestamp))&&e.id));
  assert.equal(new Set(log.map(e=>e.id)).size,3);
  assert.equal(getBalance(account,h.transactions()),account.opening+250);
});
test('failed archive saves neither archive state nor history',()=>{
  const h=storeHarness();h.store.add(entry('s','sale',100));const before=h.storage.getItem(history.LEDGER_STORAGE_KEY);
  h.fail();assert.throws(()=>h.store.setArchived('s',true));assert.equal(h.storage.getItem(history.LEDGER_STORAGE_KEY),before);
});
test('repeated archive/restore rejected and archived entries must be restored before editing',()=>{
  const h=storeHarness(),t=entry('s','sale',100);h.store.add(t);h.store.setArchived('s',true);
  assert.throws(()=>h.store.setArchived('s',true));assert.throws(()=>h.store.updateTransaction({...t,amount:200}));
  assert.throws(()=>h.store.add({...t,id:'other'}));
  h.store.setArchived('s',false);assert.throws(()=>h.store.setArchived('s',false));
});
test('legacy records migrate with their amounts and empty history; new snapshot is authoritative',()=>{
  const m=new Map([['aegis-agencies',JSON.stringify([account])],['aegis-transactions',JSON.stringify([entry('s','sale',199)])]]);
  const storage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};
  const snapshot=history.readLedgerSnapshot(storage,[],[]);assert.equal(snapshot.transactions[0].amount,199);assert.deepEqual(snapshot.activity,[]);
  const raw=history.persistLedger(storage,null,snapshot);assert.equal(storage.getItem('aegis-transactions'),JSON.stringify([entry('s','sale',199)]));
  assert.deepEqual(history.readLedgerSnapshot(storage,[],[]),snapshot);
  assert.throws(()=>history.persistLedger(storage,null,snapshot));assert.equal(storage.getItem(history.LEDGER_STORAGE_KEY),raw);
});
test('agency opening balance edits and agency creation/deletion are logged',()=>{
  const h=storeHarness();h.store.updateAgency({...account,opening:30000,code:'A',name:'Agency A'});
  const added={...account,id:'b',opening:0,code:'B',name:'Agency B'};h.store.addAgency(added);h.store.deleteAgency('b');
  const log=h.snapshot().activity;assert.equal(log[0].before.opening,10000);assert.equal(log[0].after.opening,30000);
  assert.deepEqual(log.map(e=>e.action),['edit','create','archive']);
});


test('cloud saves await server acknowledgement and never write a local ledger',async()=>{
  let resolve; const response=new Promise(done=>{resolve=done;});
  const snapshot={version:2,revision:0,agencies:[{...account,code:'A',name:'Agency A',active:true}],transactions:[],activity:[]};
  let captured;
  const h=storeHarness({snapshot,mutate:(event,revision)=>{captured={event,revision};return response;}});
  const saving=h.store.add(entry('s','sale',100));
  assert(saving instanceof Promise);assert.equal(h.updates.length,0);assert.equal(h.storage.getItem(history.LEDGER_STORAGE_KEY),null);
  resolve({...snapshot,revision:1,transactions:[{...entry('s','sale',100),status:'synced'}]});await saving;
  assert.equal(h.updates[0].revision,1);assert.equal(captured.revision,0);assert.equal(captured.event.action,'create');assert.equal(h.storage.getItem(history.LEDGER_STORAGE_KEY),null);
});
test('cloud rejection leaves UI and local data unchanged',async()=>{
 const snapshot={version:2,revision:0,agencies:[{...account,code:'A',name:'Agency A',active:true}],transactions:[],activity:[]};
 const h=storeHarness({snapshot,mutate:async()=>{throw Error('Permission denied');}});
 await assert.rejects(h.store.add(entry('s','sale',100)),/Permission denied/);assert.equal(h.updates.length,0);assert.equal(h.storage.getItem(history.LEDGER_STORAGE_KEY),null);
});

test('agency form saves edits against latest store data and audits merged values', () => {
  const h = storeHarness();
  const original = { ...account, code: 'A', name: 'Agency A', active: true };
  h.store.updateAgency({ ...original, phone: '123' });
  h.store.updateAgency({ ...original, opening: 454545500 }, original);
  const saved = h.snapshot();
  assert.equal(saved.agencies[0].opening, 454545500);
  assert.equal(saved.agencies[0].phone, '123');
  assert.equal(saved.activity.at(-1).before.phone, '123');
  assert.equal(saved.activity.at(-1).after.phone, '123');
  const persisted = h.storage.getItem(history.LEDGER_STORAGE_KEY);
  assert.throws(() => h.store.updateAgency({ ...original, opening: 50000 }, original), /Opening balance changed/);
  assert.equal(h.storage.getItem(history.LEDGER_STORAGE_KEY), persisted);
});
test('PDF report totals and end marker appear only on the final page of a long ledger',()=>{
 const rows=Array.from({length:300},(_,i)=>({date:'2026-09-20',voucher:`LONG-${i}`,narration:'Ticket sale details for pagination verification',method:'',debit:10000,credit:0,balance:(i+1)*10000}));
 const pdf=createLedgerPdf({account:'Long ledger',from:'2026-09-01',to:'2026-09-30',opening:0,rows});
 assert(pdf.getNumberOfPages()>=10);
 for(let i=1;i<=pdf.getNumberOfPages();i++){
  const content=pdf.internal.pages[i].join('\n');
  assert.equal(content.includes('(Total Closing Balance :)'),i===pdf.getNumberOfPages());
  assert.equal(content.includes('(*** End of the Report ***)'),i===pdf.getNumberOfPages());
  assert(!content.includes('(Total Debit     :)'));assert(!content.includes('(Total Credit    :)'));
 }
 const last=pdf.internal.pages[pdf.getNumberOfPages()].join('\n');
 assert(last.includes('(30,000)'));assert(last.includes('(30,000.00 Dr)'));
});

test('empty PDF retains credit opening balance in the final total',()=>{
 const pdf=createLedgerPdf({account:'Empty ledger',from:'2026-09-01',to:'2026-09-30',opening:-500000,rows:[]});
 assert.equal(pdf.getNumberOfPages(),1);
 const page=pdf.internal.pages[1].join('\n');
 assert(page.includes('(Total Closing Balance :)'));assert(page.includes('(5,000.00 Cr)'));
});
