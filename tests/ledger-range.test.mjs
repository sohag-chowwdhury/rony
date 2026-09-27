import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completeLedger,ledgerDateWindow} from '../src/shared/accounting.mjs';
test('ledger defaults cover the previous and next calendar year including leap day',()=>{
 assert.deepEqual(ledgerDateWindow('2026-09-27'),{from:'2025-09-27',to:'2027-09-27'});
 assert.deepEqual(ledgerDateWindow('2024-02-29'),{from:'2023-02-28',to:'2025-02-28'});
});
test('complete PDF ledger includes more than 50 rows and dates outside the screen range',()=>{
 const agency={id:'a',opening:5000,openingSide:'Cr',openingDate:'2020-01-01'};
 const entries=Array.from({length:120},(_,i)=>({id:String(i),agencyId:'a',type:i%2?'sale':'payment',amount:10000,date:i<60?'2021-01-01':'2030-01-01',createdAt:'2026-01-01T00:00:00Z',voucher:String(i)}));
 const result=completeLedger(agency,[...entries,{...entries[0],id:'other',agencyId:'b',amount:999999}],'2026-09-27');
 assert.equal(result.rows.length,120);assert.equal(result.from,'2020-01-01');assert.equal(result.to,'2030-01-01');
 assert.equal(result.totalDebit,600000);assert.equal(result.totalCredit,600000);assert.equal(result.closing,-5000);
});
test('empty full ledger retains opening date and balance',()=>{
 const result=completeLedger({id:'a',opening:7000,openingSide:'Dr',openingDate:'2026-09-27'},[],'2026-09-27');
 assert.equal(result.rows.length,0);assert.equal(result.closing,7000);assert.equal(result.from,result.to);
});

test('ledger and full PDF place the last saved entry at the bottom even when backdated',async()=>{
 const {compareLedgerEntries}=await import('../src/shared/accounting.mjs');
 const agency={id:'a',opening:0,openingSide:'Dr'};
 const base={agencyId:'a',type:'sale',amount:100,date:'2026-09-27'};
 const rows=[{...base,id:'latest',voucher:'last',createdAt:'2026-09-27T10:00:00Z'},{...base,id:'earlier',voucher:'first',createdAt:'2026-09-27T14:00:00+06:00'},{...base,id:'previous',voucher:'old',date:'2026-09-26',createdAt:'2026-09-27T12:00:00Z'}];
 const expected=['earlier','latest','previous'];
 assert.deepEqual([...rows].sort(compareLedgerEntries).map(t=>t.id),expected);
 const full = completeLedger(agency,rows,'2026-09-27');
 assert.deepEqual(full.rows.map(({t})=>t.id),expected);
 assert.deepEqual(full.rows.map(({running})=>running),[100,200,300]);
 assert.equal(full.closing,300);
});
