import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true } });
let createPersonalLedgerPdf, personalPdfEntries;
try {
    ({ createPersonalLedgerPdf, personalPdfEntries } = await server.ssrLoadModule('/src/personalLedgerPdf.ts'));
} finally {
    await server.close();
}
const entry = { id: 'a', person: 'Rahim', direction: 'receivable', amount: 10000, paid: 3000, date: '2026-09-28', reason: 'Rent', createdAt: '2026-09-28T12:00:00Z' };
const entries = [entry, { ...entry, id: 'b', person: 'Karim', direction: 'payable' }, { ...entry, id: 'c', person: ' rahim ', date: '2026-09-27' }, { ...entry, id: 'd', deleted: true }];

test('person PDF includes all matching loans and excludes other people and deleted entries', () => {
    assert.deepEqual(personalPdfEntries(entries, 'RAHIM').map(item => item.id), ['c', 'a']);
    assert.equal(entries[0].id, 'a');
    const output = createPersonalLedgerPdf(entries, 'Rahim').output();
    assert.ok(output.startsWith('%PDF-'));
    assert.ok(output.includes('Rahim'));
    assert.ok(!output.includes('Karim'));
    assert.ok(output.includes('Outstanding to receive: 140.00'));
    assert.ok(output.includes('Outstanding to pay: 0.00'));
});

test('full PDF includes all people with separate receivable and payable balances', () => {
    assert.equal(personalPdfEntries(entries).length, 3);
    const output = createPersonalLedgerPdf(entries).output();
    assert.ok(output.includes('Rahim'));
    assert.ok(output.includes('Karim'));
    assert.ok(output.includes('Outstanding to receive: 140.00'));
    assert.ok(output.includes('Outstanding to pay: 70.00'));
});

test('large full reports paginate and retain their final entry', () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({ ...entry, id: String(index).padStart(3, '0'), reason: index === 99 ? 'Final record' : 'Loan details '.repeat(20) }));
    const pdf = createPersonalLedgerPdf(rows);
    assert.ok(pdf.getNumberOfPages() > 1);
    assert.ok(pdf.output().includes('Final record'));
});

test('empty reports do not produce a misleading download', () => {
    assert.throws(() => createPersonalLedgerPdf([]), /No personal entries/);
    assert.throws(() => createPersonalLedgerPdf(entries, 'Missing'), /No personal entries/);
});
test('repayment dates, amounts and notes are scoped to the selected person', () => {
    const payments = {
        a: [
            { id: 'p2', amount: 2000, date: '2026-10-02', note: 'Second installment' },
            { id: 'p1', amount: 1000, date: '2026-10-01', note: 'First installment' },
        ],
        b: [{ id: 'p3', amount: 3000, date: '2026-10-03', note: 'Karim private note' }],
        d: [{ id: 'p4', amount: 3000, date: '2026-10-04', note: 'Deleted private note' }],
    };
    const output = createPersonalLedgerPdf(entries, 'Rahim', payments).output();
    for (const text of ['2026-10-01', '2026-10-02', 'First installment', 'Second installment', '10.00', '20.00', 'Received']) assert.ok(output.includes(text), text);
    assert.ok(output.indexOf('First installment') < output.indexOf('Second installment'));
    assert.ok(!output.includes('Karim private note'));
    assert.ok(!output.includes('Deleted private note'));
    assert.equal(payments.a[0].id, 'p2');
    const full = createPersonalLedgerPdf(entries, undefined, payments).output();
    assert.ok(full.includes('Karim private note'));
    assert.ok(full.includes('(Paid)'));
});

test('long repayment histories paginate without losing the last payment', () => {
    const payments = { a: Array.from({ length: 100 }, (_, index) => ({ id: String(index).padStart(3, '0'), amount: 30, date: '2026-10-01', note: index === 99 ? 'Last installment' : 'Payment note '.repeat(25) })) };
    const pdf = createPersonalLedgerPdf([entry], undefined, payments);
    assert.ok(pdf.getNumberOfPages() > 2);
    assert.ok(pdf.output().includes('Last installment'));
});

test('unpaid entries explicitly show that no repayment has been recorded', () => {
    const output = createPersonalLedgerPdf([{ ...entry, paid: 0 }], undefined, {}).output();
    assert.ok(output.includes('No repayments recorded.'));
    assert.ok(output.includes('Exact payment times were not stored.'));
});
test('a settled loan and its repayment share one page in person and full PDFs', () => {
    const loan = { ...entry, person: 'Habib', amount: 1000000, paid: 1000000, reason: "It's loan" };
    const payments = { a: [{ id: 'p1', amount: 1000000, date: '2026-09-28', note: 'Just first payment' }] };
    for (const person of ['Habib', undefined]) {
        const pdf = createPersonalLedgerPdf([loan], person, payments);
        assert.equal(pdf.getNumberOfPages(), 1);
        const output = pdf.output();
        assert.ok(output.includes('Repayment history'));
        assert.ok(output.includes('Just first payment'));
        assert.equal((output.match(/Personal ledger \| Page/g) || []).length, 1);
    }
});