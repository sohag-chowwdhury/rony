import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profitSummary, calculateLedger, transactionLedgerNarration, activeLedgerRecords, parseMoney } from '../src/shared/accounting.mjs';
import { applyMutation, validateImport } from '../src/shared/ledger-domain.mjs';

const agency = { id:'agency',code:'A',name:'Agency',active:true,opening:0,openingSide:'Dr' };
const sale = { id:'sale',type:'sale',agencyId:'agency',date:'2026-09-27',voucher:'V-1',amount:100000,ticketCost:70000,ticket:'ticket',passenger:'Passenger',createdAt:'2026-09-27T10:00:00Z',status:'synced' };
const refund = { id:'refund',type:'payment',agencyId:'agency',date:'2026-09-27',voucher:'RC-1',amount:12500,method:'Tax Refund',narration:'Tax Return',reference:'V-1',createdAt:'2026-09-27T11:00:00Z',status:'synced' };
const snapshot = {version:2,agencies:[agency],transactions:[sale],activity:[]};
const create = () => applyMutation(snapshot,{entity:'transaction',action:'create',id:refund.id,record:refund,operationId:'create-refund'},'Tester',refund.createdAt);

test('tax refund posts a separate bottom credit and deducts profit without changing the sale',()=>{
    const result=create();
    assert.deepEqual(result.next.transactions[0],sale);
    const ledger=calculateLedger(agency,result.next.transactions,'2026-01-01','2026-12-31');
    assert.equal(ledger.rows.at(-1).t.id,'refund');
    assert.equal(ledger.totalCredit,12500);
    assert.equal(ledger.closing,87500);
    assert.deepEqual(profitSummary(result.next.transactions),{total:17500,missingCosts:0});
    assert.equal(transactionLedgerNarration(result.after,agency),'Tax Return');
});

test('ordinary credits do not deduct profit and refunds can produce a loss',()=>{
    assert.equal(profitSummary([sale,{...refund,method:'Cash'}]).total,30000);
    assert.equal(profitSummary([sale,{...refund,amount:40000}]).total,-10000);
    assert.deepEqual(profitSummary([{...sale,ticketCost:undefined},refund]),{total:-12500,missingCosts:1});
});

test('refund edits and reversals adjust profit and credit exactly once',()=>{
    const created=create();
    const edited=applyMutation(created.next,{entity:'transaction',action:'edit',id:'refund',record:{...refund,amount:20000},operationId:'edit-refund'},'Tester','2026-09-27T12:00:00Z');
    assert.equal(profitSummary(edited.next.transactions).total,10000);
    const reversed=applyMutation(edited.next,{entity:'transaction',action:'reverse',id:'refund',record:{date:'2026-09-28',reason:'Correction'},operationId:'reverse-refund'},'Tester','2026-09-28T10:00:00Z');
    assert.equal(profitSummary(reversed.next.transactions).total,30000);
    assert.equal(profitSummary([reversed.after],reversed.next.transactions).total,20000);
    assert.equal(calculateLedger(agency,reversed.next.transactions,'2026-01-01','2026-12-31').closing,100000);
});

test('refund classification survives backup import and follows archive visibility',()=>{
    const result=create();
    const imported=validateImport({...result.next,activity:[result.event]});
    assert.equal(profitSummary(imported.transactions).total,17500);
    const archived=applyMutation(result.next,{entity:'transaction',action:'archive',id:'refund',operationId:'archive-refund'},'Tester','2026-09-28T10:00:00Z');
    const visible=activeLedgerRecords(archived.next.agencies,archived.next.transactions);
    assert.equal(profitSummary(visible.transactions).total,30000);
});

test('refund amounts reject zero, negative and fractional minor units',()=>{
    for (const amount of ['0','-1','1.001']) assert.throws(()=>parseMoney(amount));
    for (const amount of [0,-100,1.5]) assert.throws(()=>applyMutation(snapshot,{entity:'transaction',action:'create',id:'refund',record:{...refund,amount},operationId:'bad-refund'},'Tester',refund.createdAt));
    assert.equal(parseMoney('125.50'),12550);
});