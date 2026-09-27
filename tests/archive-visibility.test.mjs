import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activeLedgerRecords, getBalance, completeLedger, profitSummary} from '../src/shared/accounting.mjs';
test('archived sales leave active ledger, dashboard totals and PDF, and restore brings them back',()=>{
 const agency={id:'a',opening:0,openingSide:'Dr'};
 const sale={id:'s',agencyId:'a',type:'sale',amount:12000,ticketCost:10000,date:'2026-09-27',createdAt:'2026-09-27T00:00:00Z',voucher:'V1',archivedAt:'2026-09-27T12:00:00Z'};
 const visible=activeLedgerRecords([agency],[sale]);
 assert.equal(visible.transactions.length,0);assert.equal(getBalance(agency,visible.transactions),0);assert.equal(profitSummary(visible.transactions).total,0);
 assert.equal(completeLedger(agency,visible.transactions,'2026-09-27').rows.length,0);
 assert.equal(sale.amount,12000);assert(sale.archivedAt);
 const restored=activeLedgerRecords([agency],[{...sale,archivedAt:undefined}]);
 assert.equal(getBalance(agency,restored.transactions),12000);assert.equal(profitSummary(restored.transactions).total,2000);
});
test('archived agencies hide their transactions; restoring an agency still keeps individually archived entries hidden',()=>{
 const a={id:'a',archivedAt:'2026-09-27'};const entries=[{agencyId:'a'},{agencyId:'a',archivedAt:'2026-09-27'}];
 assert.deepEqual(activeLedgerRecords([a],entries),{agencies:[],transactions:[]});
 assert.equal(activeLedgerRecords([{id:'a'}],entries).transactions.length,1);
});
