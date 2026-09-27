import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ticketProfit, calculateLedger, validateEntry } from '../src/shared/accounting.mjs';
import { cleanRecord, applyMutation } from '../src/shared/ledger-domain.mjs';
const agency={id:'a',code:'A',name:'Agency',active:true,opening:0,openingSide:'Dr'};
const sale={id:'s',type:'sale',agencyId:'a',date:'2026-09-27',voucher:'V1',ticket:'T1',passenger:'Passenger',amount:120015,ticketCost:100010,createdAt:'2026-09-27T12:00:00Z',status:'synced'};
test('sale cost persists and profit is separate from ledger debit',()=>{
 const saved=cleanRecord('transaction',sale);
 assert.equal(saved.ticketCost,100010);
 assert.equal(ticketProfit(saved),20005);
 const ledger=calculateLedger(agency,[saved],'2026-09-01','2026-09-30');
 assert.equal(ledger.totalDebit,120015);assert.equal(ledger.closing,120015);
 const changed=applyMutation({agencies:[agency],transactions:[saved],activity:[]},{entity:'transaction',action:'edit',id:'s',operationId:'edit1',record:{...saved,ticketCost:110000}},'tester','2026-09-27T13:00:00Z').after;
 assert.equal(changed.id,sale.id);assert.equal(changed.voucher,sale.voucher);assert.equal(changed.amount,sale.amount);assert.equal(ticketProfit(changed),10015);
});
test('profit handles losses, zero cost and unknown historical cost',()=>{
 assert.equal(ticketProfit({...sale,ticketCost:130015}),-10000);
 assert.equal(ticketProfit({...sale,ticketCost:0}),120015);
 assert.equal(ticketProfit({...sale,ticketCost:undefined}),null);
 assert.equal(ticketProfit({...sale,reversalOf:'other'}),null);
});
test('invalid cost is rejected by save and backup entry validation',()=>{
 for(const ticketCost of [-1,1.5,NaN,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>cleanRecord('transaction',{...sale,ticketCost}));
  assert.throws(()=>validateEntry({...sale,ticketCost},[agency],[]));
 }
 assert.throws(()=>cleanRecord('transaction',{...sale,type:'payment'}));
});

test('profit totals respect selected rows, reversals, losses and missing costs',async()=>{
 const {profitSummary}=await import('../src/shared/accounting.mjs');
 const reversal={...sale,id:'rev',type:'payment',ticketCost:undefined,reversalOf:sale.id,date:'2026-09-28'};
 const loss={...sale,id:'loss',amount:90000,ticketCost:100000};
 const unknown={...sale,id:'old',ticketCost:undefined};
 const receipt={...sale,id:'receipt',type:'payment',ticketCost:undefined};
 assert.deepEqual(profitSummary([sale,loss,unknown,receipt]),{total:10005,missingCosts:1});
 assert.deepEqual(profitSummary([sale,reversal]),{total:0,missingCosts:0});
 assert.deepEqual(profitSummary([reversal],[sale,reversal]),{total:-20005,missingCosts:0});
 assert.deepEqual(profitSummary([sale],[sale,reversal]),{total:20005,missingCosts:0});
 assert.deepEqual(profitSummary([]),{total:0,missingCosts:0});
});
