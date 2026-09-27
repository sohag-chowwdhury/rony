import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyTicketMigration,applyMutation} from '../src/shared/ledger-domain.mjs';
import {getBalance,profitSummary,activeLedgerRecords,calculateLedger,completeLedger,mergeMigratedEntries,ticketHistory} from '../src/shared/accounting.mjs';
const a={id:'a',name:'Source',code:'A',active:true,opening:0,openingSide:'Dr'},b={...a,id:'b',code:'B',name:'Destination'};
const source={id:'source',agencyId:'a',type:'sale',amount:5000000,ticketCost:4500000,date:'2026-09-27',voucher:'V1',ticket:'OLD',passenger:'Original',status:'synced',createdAt:'2026-09-27T01:00:00Z'};
const snapshot={version:2,agencies:[a,b],transactions:[source],activity:[]};
const request={sourceId:source.id,sourcePrice:source.amount,operationId:'mig1',destination:{agencyId:'b',date:'2026-09-27',amount:5500000,voucher:'V2',ticket:'NEW',passenger:'New passenger',narration:'Customer ticket'}};
test('migration atomically credits source, debits destination and keeps profit once',()=>{
 const result=applyTicketMigration(snapshot,request,'Tester','2026-09-27T02:00:00Z');
 assert.equal(result.next.transactions.length,3);assert.equal(snapshot.transactions.length,1);
 assert.equal(getBalance(a,result.next.transactions),0);assert.equal(getBalance(b,result.next.transactions),5500000);
 assert.equal(profitSummary(result.next.transactions).total,1000000);
 assert.equal(result.sale.ticketCost,4500000);assert.equal(result.sale.passenger,'New passenger');
 assert.equal(result.credit.narration,'Ticket adjustment');assert.equal(result.sale.narration,'Customer ticket');
 assert.equal(result.event.action,'migrate');assert.equal(result.after.migration.id,result.sale.migration.id);
 assert.throws(()=>applyTicketMigration(result.next,request,'Tester','2026-09-27T03:00:00Z'),/unmigrated/);
 for(const action of ['edit','archive','reverse'])assert.throws(()=>applyMutation(result.next,{entity:'transaction',action,id:result.credit.id,record:result.credit,operationId:'x'},'Tester','2026-09-27T03:00:00Z'));
});
test('migration rejects invalid agency, dates, details and closed periods without changing records',()=>{
 for(const destination of [{...request.destination,agencyId:'a'},{...request.destination,passenger:''},{...request.destination,date:'2026-09-26'},{...request.destination,amount:-1}])assert.throws(()=>applyTicketMigration(snapshot,{...request,destination},'Tester','2026-09-27T02:00:00Z'));
 assert.throws(()=>applyTicketMigration({...snapshot,agencies:[a,{...b,closedThrough:'2026-09-27'}]},request,'Tester','2026-09-27T02:00:00Z'),/closed/);
 assert.equal(snapshot.transactions.length,1);
});

test('backup validates migration links and rejects missing credit or mismatched prices',async()=>{
 const {validateBackup}=await import('../src/shared/ledgerControls.mjs');
 const result=applyTicketMigration(snapshot,request,'Tester','2026-09-27T02:00:00Z');
 assert.doesNotThrow(()=>validateBackup({...result.next,activity:[result.event]}));
 assert.throws(()=>validateBackup({...result.next,transactions:result.next.transactions.filter(t=>t.id!==result.credit.id)}),/migration/i);
 assert.throws(()=>validateBackup({...result.next,transactions:result.next.transactions.map(t=>t.id===result.sale.id?{...t,ticketCost:1}:t)}),/migration/i);
 assert.throws(()=>applyTicketMigration(snapshot,{...request,sourcePrice:1},'Tester','2026-09-27T02:00:00Z'),/price changed/i);
});


test('migration preserves the original debit and dated adjustment credit across ledger and PDF',()=>{
 const result=applyTicketMigration(snapshot,{...request,destination:{...request.destination,date:'2026-09-30'}},'Tester','2026-09-27T02:00:00Z');
 const raw=result.next.transactions;
 const before=JSON.stringify(raw);
 const visible=activeLedgerRecords([a,b],raw).transactions;
 assert.equal(visible.length,3);
 const debit=visible.find(t=>t.id===source.id);
 assert.equal(debit.type,'sale');assert.equal(debit.amount,source.amount);
 assert.equal(debit.voucher,source.voucher);assert.equal(debit.ticket,source.ticket);
 assert.equal(debit.date,source.date);assert.equal(debit.ticketCost,source.ticketCost);
 assert.deepEqual(visible.find(t=>t.id===result.credit.id),result.credit);
 assert.equal(visible.find(t=>t.id===result.sale.id).type,'sale');
 assert.deepEqual(mergeMigratedEntries(visible),visible);
 for(const entries of [raw,visible]){
  const ledger=calculateLedger(a,entries,'2026-09-01','2026-09-30');
  assert.equal(ledger.rows.length,2);assert.equal(ledger.totalDebit,source.amount);
  assert.equal(ledger.totalCredit,source.amount);assert.equal(ledger.closing,0);
  assert.deepEqual(ledger.rows.map(row=>row.running),[source.amount,0]);
  assert.equal(getBalance(a,entries),0);assert.equal(getBalance(b,entries),5500000);
  assert.equal(profitSummary(entries).total,1000000);
  const pdf=completeLedger(a,entries,'2026-09-30');
  assert.equal(pdf.rows.length,2);assert.equal(pdf.rows[0].t.id,source.id);
  assert.equal(pdf.totalDebit,source.amount);assert.equal(pdf.totalCredit,source.amount);assert.equal(pdf.closing,ledger.closing);
  const earlier=calculateLedger(a,entries,'2026-09-27','2026-09-29');
  assert.equal(earlier.rows.length,1);assert.equal(earlier.totalCredit,0);assert.equal(earlier.closing,source.amount);
  const later=calculateLedger(a,entries,'2026-09-30','2026-09-30');
  assert.equal(later.rows.length,1);assert.equal(later.opening,source.amount);assert.equal(later.closing,0);
 }
 assert.equal(JSON.stringify(raw),before);
});

test('three agencies retain buying cost and count final profit only once, including losses', async()=>{
 const {validateBackup}=await import('../src/shared/ledgerControls.mjs');
 const c={...a,id:'c',code:'C',name:'Third'};
 for(const cost of [4500000,0,undefined]) for(const finalPrice of [6000000,4700000,4500000,4000000]) {
  const initial={...snapshot,agencies:[a,b,c],transactions:[{...source,ticketCost:cost}]};
  const first=applyTicketMigration(initial,request,'Tester','2026-09-27T02:00:00Z');
  const second=applyTicketMigration(first.next,{sourceId:first.sale.id,sourcePrice:first.sale.amount,operationId:'mig2',destination:{...request.destination,agencyId:'c',amount:finalPrice,voucher:'V3'}},'Tester','2026-09-27T03:00:00Z');
  const expected={total:cost===undefined?0:finalPrice-cost,missingCosts:cost===undefined?1:0};
  assert.equal(second.sale.ticketCost,cost);
  assert.deepEqual(ticketHistory(second.sale,second.next.transactions).map(t=>t.amount),[5000000,5500000,finalPrice]);
  assert.doesNotThrow(()=>validateBackup(second.next));
  const visible=activeLedgerRecords(second.next.agencies,second.next.transactions).transactions;
  assert.deepEqual(mergeMigratedEntries(visible),visible);
  for(const rows of [second.next.transactions,visible]) {
   assert.deepEqual([a,b,c].map(agency=>getBalance(agency,rows)),[0,0,finalPrice]);
   assert.deepEqual(profitSummary(rows),expected);
   const agencyTotals=[a,b,c].map(agency=>profitSummary(rows.filter(t=>t.agencyId===agency.id),rows));
   assert.deepEqual(agencyTotals,[{total:0,missingCosts:0},{total:0,missingCosts:0},expected]);
  }
  const filtered=activeLedgerRecords([{...a,archivedAt:'2026-09-28'}, {...b,archivedAt:'2026-09-28'},c],second.next.transactions).transactions;
  assert.deepEqual(profitSummary(filtered),expected);
  assert.throws(()=>applyTicketMigration(second.next,{...request,operationId:'duplicate'},'Tester','2026-09-27T04:00:00Z'),/unmigrated/);
 }
});
test('legacy migration costs are resolved without modifying saved records and can migrate onward',async()=>{
 const {validateBackup}=await import('../src/shared/ledgerControls.mjs');
 const first=applyTicketMigration(snapshot,request,'Tester','2026-09-27T02:00:00Z');
 for(const t of first.next.transactions){delete t.migration.rootId;if(t.id===first.sale.id)t.ticketCost=source.amount;}
 const saved=JSON.stringify(first.next);
 assert.doesNotThrow(()=>validateBackup(first.next));
 assert.deepEqual(profitSummary(first.next.transactions),{total:1000000,missingCosts:0});
 const visible=activeLedgerRecords([a,b],first.next.transactions).transactions;
 assert.equal(visible.find(t=>t.id===first.sale.id).ticketCost,source.ticketCost);
 assert.equal(JSON.stringify(first.next),saved);
 const next=applyTicketMigration(first.next,{sourceId:first.sale.id,sourcePrice:first.sale.amount,operationId:'return',destination:{...request.destination,agencyId:'a',amount:4700000,voucher:'V3'}},'Tester','2026-09-27T03:00:00Z');
 assert.equal(next.sale.ticketCost,4500000);assert.equal(profitSummary(next.next.transactions).total,200000);
 assert.doesNotThrow(()=>validateBackup(next.next));
});
test('backup rejects a forged original cost or root and broken onward links',async()=>{
 const {validateBackup}=await import('../src/shared/ledgerControls.mjs');
 const first=applyTicketMigration(snapshot,request,'Tester','2026-09-27T02:00:00Z');
 const second=applyTicketMigration(first.next,{sourceId:first.sale.id,sourcePrice:first.sale.amount,operationId:'mig2',destination:{...request.destination,agencyId:'a',voucher:'V3'}},'Tester','2026-09-27T03:00:00Z');
 for(const mutate of [data=>{data.transactions.find(t=>t.id===second.sale.id).ticketCost=1;},data=>{delete data.transactions.find(t=>t.id===first.sale.id).nextMigration;},data=>{for(const t of data.transactions){if(t.migration?.id==='mig2')t.migration.rootId=first.sale.id;if(t.nextMigration)t.nextMigration.rootId=first.sale.id;}}]) {
  const bad=structuredClone(second.next);mutate(bad);assert.throws(()=>validateBackup(bad),/migration/i);
 }
});

test('migration offsets only the ticket debit and preserves opening balance and prior receipts',()=>{
 const account={...a,opening:200000};
 const receipt={id:'receipt',agencyId:a.id,type:'payment',amount:1000000,date:'2026-09-27',voucher:'R1',createdAt:'2026-09-27T01:30:00Z'};
 const initial={...snapshot,agencies:[account,b],transactions:[source,receipt]};
 const result=applyTicketMigration(initial,request,'Tester','2026-09-27T02:00:00Z');
 for(const entries of [result.next.transactions,activeLedgerRecords(initial.agencies,result.next.transactions).transactions]){
  assert.equal(getBalance(account,entries),-800000);
  const ledger=calculateLedger(account,entries,'2026-09-01','2026-09-30');
  assert.equal(ledger.opening,200000);assert.equal(ledger.totalDebit,5000000);
  assert.equal(ledger.totalCredit,6000000);assert.equal(ledger.closing,-800000);
 }
});
