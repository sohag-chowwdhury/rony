import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMutation, cleanRecord, validateImport } from '../src/shared/ledger-domain.mjs';
import { getBalance } from '../src/shared/accounting.mjs';
const clock='2026-09-24T12:34:56.000Z';
const agency={id:'a',code:'A',name:'Agency',opening:10000,openingSide:'Dr',active:true};
const tx={id:'t',type:'sale',agencyId:'a',date:'2026-09-24',voucher:'V1',ticket:'T1',passenger:'Passenger',amount:15000,createdAt:'1999-01-01T00:00:00Z',status:'pending'};
const initial=()=>({agencies:[agency],transactions:[],activity:[],revision:0});
const change=(snapshot,action,record=tx,entity='transaction')=>applyMutation(snapshot,{entity,action,id:record.id,record,operationId:`op-${action}`},'owner@example.com',clock);
test('server sets actor, timestamp and confirmed status, ignoring claimed creation date',()=>{
 const result=change(initial(),'create');
 assert.equal(result.after.createdAt,clock);assert.equal(result.after.status,'synced');assert.equal(result.event.actor,'owner@example.com');assert.equal(result.event.timestamp,clock);
 assert.equal(getBalance(agency,result.next.transactions),25000);
});
test('server rejects negative amounts, unknown fields, malformed types and invalid dates',()=>{
 for(const candidate of [{...tx,amount:-100},{...tx,amount:'100'},{...tx,amount:1.5},{...tx,date:'2026-02-30'},{...tx,actor:'admin'},{...tx,passenger:''}])assert.throws(()=>change(initial(),'create',candidate));
});
test('server enforces duplicate voucher and agency existence',()=>{
 const first=change(initial(),'create').next;
 assert.throws(()=>change(first,'create',{...tx,id:'other'}));assert.throws(()=>change(initial(),'create',{...tx,agencyId:'missing'}));
});
test('archive and restore are server timestamped and balance neutral',()=>{
 const created=change(initial(),'create').next,archived=change(created,'archive');
 assert.equal(archived.after.archivedAt,clock);assert.equal(getBalance(agency,archived.next.transactions),25000);
 assert.throws(()=>change(archived.next,'edit',{...tx,amount:200}));assert.throws(()=>change(archived.next,'archive'));
 const restored=change(archived.next,'restore');assert.equal(restored.after.archivedAt,undefined);assert.equal(getBalance(agency,restored.next.transactions),25000);
});
test('server preserves original created date on edit, captures old/new values, and deletes with audit',()=>{
 const created=change(initial(),'create').next,edited=change(created,'edit',{...tx,amount:5000});
 assert.equal(edited.after.createdAt,clock);assert.equal(edited.event.before.amount,15000);assert.equal(edited.event.after.amount,5000);
 const deleted=change(edited.next,'delete');assert.equal(deleted.after,null);assert.equal(deleted.event.before.amount,5000);assert.equal(getBalance(agency,deleted.next.transactions),10000);
});
test('server refuses deletion of agencies with opening balance/history',()=>{
 assert.throws(()=>change(initial(),'delete',agency,'agency'));
 const snapshot={...initial(),agencies:[{...agency,opening:0}],transactions:[tx]};assert.throws(()=>change(snapshot,'delete',snapshot.agencies[0],'agency'));
});
test('server forbids unsafe identifiers and archive injection',()=>{
 assert.throws(()=>cleanRecord('transaction',{...tx,id:'../other'}));assert.throws(()=>change(initial(),'create',{...tx,archivedAt:clock}));
});
test('import preserves archived records, rejects duplicate accounts and incomplete records',()=>{
 const backup={agencies:[agency],transactions:[{...tx,archivedAt:clock}],activity:[]};
 const data=validateImport(backup);assert.equal(data.transactions[0].archivedAt,clock);assert.equal(data.transactions[0].amount,15000);
 assert.throws(()=>validateImport({...backup,agencies:[agency,agency]}));assert.throws(()=>validateImport({...backup,transactions:[tx,tx]}));
 assert.throws(()=>validateImport({...backup,transactions:Array.from({length:401},()=>tx)}));
});

test('agency archive and restore preserve funds, prohibit stale edits, and survive import',()=>{
 const created=change(initial(),'create').next;
 const archived=change(created,'archive',agency,'agency');
 assert.equal(archived.after.active,false);assert.equal(archived.after.archivedAt,clock);
 assert.equal(getBalance(archived.after,archived.next.transactions),25000);
 assert.throws(()=>change(archived.next,'edit',agency,'agency'));
 assert.throws(()=>change(archived.next,'archive',agency,'agency'));
 const imported=validateImport({...archived.next,activity:[]});assert.equal(imported.agencies[0].archivedAt,clock);
 const restored=change(archived.next,'restore',agency,'agency');assert.equal(restored.after.active,true);assert.equal(restored.after.archivedAt,undefined);
 assert.equal(getBalance(restored.after,restored.next.transactions),25000);
});
test('archived history still prevents agency deletion',()=>{
 const snapshot={...initial(),agencies:[{...agency,opening:0}],transactions:[{...tx,archivedAt:clock}]};
 assert.throws(()=>change(snapshot,'delete',snapshot.agencies[0],'agency'));
});
test('server validates required bank, cheque and wallet details on save',()=>{
 const payment={...tx,type:'payment'};
 for(const method of ['Bank Transfer','Cheque','bKash','Nagad','Rocket'])assert.throws(()=>change(initial(),'create',{...payment,method}));
 assert.doesNotThrow(()=>change(initial(),'create',{...payment,method:'Cash'}));
 assert.doesNotThrow(()=>change(initial(),'create',{...payment,method:'Bank Transfer',sendingBank:'BRAC Bank PLC',receivingBank:'City Bank PLC'}));
 assert.throws(()=>change(initial(),'create',{...payment,method:'Bank Transfer',sendingBank:'Other Bank',receivingBank:'City Bank PLC'}));
});
