import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transformWithOxc } from 'vite';
const source = await fs.readFile(new URL('../src/personalAccounting.ts', import.meta.url), 'utf8');
const { code } = await transformWithOxc(source, 'personalLedger.ts');
const { personalTotals, applyPersonalPayment, editPersonalEntry, validatePersonalEntry, PERSONAL_STORAGE_KEY } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const entry = { id: 'a', person: 'Rahim', direction: 'receivable', amount: 10000, paid: 0, date: '2026-09-28', reason: 'Rent', createdAt: '2026-09-28T12:00:00Z' };
test('personal receivables and payables remain separate after partial and full repayments', () => {
 const partial = applyPersonalPayment(entry, { id: 'p', amount: 3000, date: entry.date, note: '' });
 assert.deepEqual(personalTotals([partial, { ...entry, id: 'b', direction: 'payable', amount: 2000 }]), { receivable: 7000, payable: 2000 });
 assert.equal(applyPersonalPayment(partial, { id: 'q', amount: 7000, date: entry.date, note: '' }).paid, 10000);
 assert.equal(entry.paid, 0);
});
test('invalid money, overpayments and earlier repayment dates are rejected', () => {
 for (const amount of [0, -1, 0.5, NaN, Infinity, 10001]) assert.throws(() => applyPersonalPayment(entry, { amount, date: entry.date, note: '' }));
 assert.throws(() => applyPersonalPayment(entry, { amount: 100, date: '2026-09-27', note: '' }));
 assert.throws(() => validatePersonalEntry({ ...entry, person: ' ' }));
 assert.throws(() => validatePersonalEntry({ ...entry, date: '2026-02-30' }));
});
test('personal storage and UI have no business ledger mutation dependencies', async () => {
 assert.equal(PERSONAL_STORAGE_KEY, 'agency-personal-ledger-v1');
 const ui = await fs.readFile(new URL('../src/PersonalLedgerPage.tsx', import.meta.url), 'utf8');
 assert.doesNotMatch(ui, /useCloudLedger|persistLedger|mutateDirectLedger|LEDGER_STORAGE_KEY/);
 assert.match(ui, /'personalLedgers'/);
});

test('edits preserve the latest repayments and immutable identity', () => {
 const current = { ...entry, paid: 3000, lastPaymentId: 'p' };
 const updated = editPersonalEntry(current, { ...entry, id: 'wrong', createdAt: 'wrong', person: 'Karim', amount: 12000, direction: 'payable', reason: 'Updated' });
 assert.equal(updated.id, entry.id);
 assert.equal(updated.createdAt, entry.createdAt);
 assert.equal(updated.paid, 3000);
 assert.equal(updated.lastPaymentId, 'p');
 assert.equal(updated.person, 'Karim');
 assert.deepEqual(personalTotals([updated]), { receivable: 0, payable: 9000 });
 assert.throws(() => editPersonalEntry(current, { ...entry, amount: 2999 }), /already repaid/);
 assert.throws(() => editPersonalEntry(current, { ...entry, date: '2026-09-29' }), /original date/);
 assert.equal(editPersonalEntry(entry, { ...entry, date: '2026-09-29' }).date, '2026-09-29');
});
test('deleted entries leave totals and reject stale edits or repayments', () => {
 const deleted = { ...entry, deleted: true };
 assert.deepEqual(personalTotals([deleted]), { receivable: 0, payable: 0 });
 assert.throws(() => editPersonalEntry(deleted, entry), /deleted/);
 assert.throws(() => applyPersonalPayment(deleted, { id: 'p', amount: 100, date: entry.date, note: '' }), /deleted/);
});
