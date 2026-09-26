import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyMutation,validateImport} from '../src/shared/ledger-domain.mjs';
import {validateBackup,validateOpening,makeReversal,validateMatch} from '../src/shared/ledgerControls.mjs';
import {getBalance,calculateLedger} from '../src/shared/accounting.mjs';
const a={id:'a',code:'A',name:'Agency',opening:10000,openingSide:'Dr',openingDate:'2026-01-01',active:true};
const sale={id:'s',agencyId:'a',type:'sale',voucher:'S',date:'2026-02-01',amount:5000,createdAt:'2026-02-01T00:00:00Z',ticket:'T',passenger:'P',status:'synced'};
const pay={id:'p',agencyId:'a',type:'payment',voucher:'P',date:'2026-02-02',amount:3000,createdAt:'2026-02-02T00:00:00Z',method:'Cash',status:'synced'};
const snapshot=()=>({version:2,agencies:[a],transactions:[sale,pay],activity:[]});
const command=(state,entity,action,id,record,operationId='operation')=>applyMutation(state,{entity,action,id,record,operationId},'audit@example.com','2026-09-25T00:00:00Z');
test('closed periods block old and backdated edits, deletion and opening changes',()=>{
 const state=snapshot();state.agencies=[{...a,closedThrough:'2026-02-28'}];
 assert.throws(()=>command(state,'transaction','edit','s',{...sale,date:'2026-03-01'}),/closed/);
 assert.throws(()=>command(state,'transaction','create','new',{...sale,id:'new',voucher:'NEW'}),/closed/);
 assert.throws(()=>command(state,'transaction','delete','s',null),/closed/);
 assert.throws(()=>command(state,'agency','edit','a',{...state.agencies[0],opening:20000}),/locked/);
 assert.throws(()=>command(state,'agency','edit','a',a),/reopened/);
 assert.doesNotThrow(()=>command(state,'transaction','create','new',{...sale,id:'new',voucher:'NEW',date:'2026-03-01'}));
});
test('opening dates protect posting history and statements',()=>{
 assert.throws(()=>validateOpening({...a,openingDate:'2026-03-01'},a,[sale]),/first transaction/);
 assert.throws(()=>calculateLedger(a,[sale],'2025-12-01','2026-02-28'),/opening balance date/);
 assert.equal(calculateLedger(a,[sale],'2026-01-01','2026-02-28').closing,15000);
 assert.throws(()=>command(snapshot(),'transaction','create','new',{...sale,id:'new',voucher:'NEW',date:'2025-12-01'}),/opening/);
});
test('reversal is linked, balance-correct, immutable, and may correct a closed period later',()=>{
 const state=snapshot();state.agencies=[{...a,closedThrough:'2026-02-28'}];
 const result=command(state,'transaction','reverse','s',{date:'2026-03-01',reason:'Wrong sale'});
 assert.equal(result.after.reversalOf,'s');assert.equal(result.after.type,'payment');assert.equal(getBalance(a,result.next.transactions),7000);
 assert.throws(()=>command(result.next,'transaction','reverse','s',{date:'2026-03-02',reason:'again'}),/already/);
 assert.throws(()=>command(result.next,'transaction','edit','s',sale),/reversed/i);
 assert.throws(()=>command(result.next,'transaction','delete',result.after.id,null),/reversed/i);
 assert.throws(()=>makeReversal(snapshot(),sale,'2026-01-31','reason','r','2026-03-01'),/precede/);
 assert.doesNotThrow(()=>validateImport({...result.next,version:2}));
});
test('bank matching validates amount and uniqueness without changing ledger balances',()=>{
 const state=snapshot(),match={bankAccount:'Bank 1234',bankReference:'REF-1',date:'2026-02-02',amount:3000};
 const result=command(state,'transaction','reconcile','p',{reconciliation:match});
 assert.equal(getBalance(a,result.next.transactions),getBalance(a,state.transactions));
 assert.throws(()=>validateMatch(state,pay,{...match,amount:2999}),/exactly/);
 assert.throws(()=>command(result.next,'transaction','edit','p',pay),/bank match/);
 assert.throws(()=>command(result.next,'transaction','reverse','p',{date:'2026-03-01',reason:'x'}),/bank match/);
 const other={...pay,id:'other',voucher:'OTHER'};assert.throws(()=>validateMatch({...result.next,transactions:[...result.next.transactions,other]},other,match),/already matched/);
 const cleared=command(result.next,'transaction','unreconcile','p',null);assert.equal(cleared.after.reconciliation,undefined);
});
test('backup validation preserves controls and rejects corrupt or duplicate relationships',()=>{
 const state=snapshot();assert.deepEqual(validateBackup(state),state);
 assert.throws(()=>validateBackup({...state,version:99}),/Unsupported/);
 assert.throws(()=>validateBackup({...state,transactions:[sale,sale]}),/already/);
 assert.throws(()=>validateBackup({...state,transactions:[{...sale,reversalOf:'missing'}]}),/reversal/);
 assert.throws(()=>validateBackup({...state,agencies:[{...a,opening:-1}]}));
 assert.throws(()=>validateBackup({...state,transactions:[{...pay,agencyId:'missing'}]}));
});
