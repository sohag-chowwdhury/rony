import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transactionLedgerNarration, calculateLedger, completeLedger } from '../src/shared/accounting.mjs';
import { applyTicketMigration } from '../src/shared/ledger-domain.mjs';

const agency = { id: 'a', name: 'Source', code: 'A', active: true, opening: 0, openingSide: 'Dr' };
const destination = { ...agency, id: 'b', name: 'Destination', code: 'B' };
const source = { id: 'source', agencyId: 'a', type: 'sale', amount: 5000000, ticketCost: 4500000, date: '2026-09-27', voucher: 'V1', reference: 'REF1', ticket: 'TICKET1', sector: 'DAC-DXB', flightDate: '2026-10-01', passenger: 'Original passenger', narration: 'Original notes', status: 'synced', createdAt: '2026-09-27T01:00:00Z' };

test('ledger narration includes ticket details and original notes', () => {
    const text = transactionLedgerNarration(source, agency);
    for (const value of ['REF1', 'TICKET1', 'DAC-DXB', 'V1', 'Source', '27-09-2026', '01-10-2026', 'Original passenger', '50000.00', 'Original notes']) assert.ok(text.includes(value), value);
});

for (const narration of ['Original notes', '']) test(`migration preserves full screen and PDF narration with notes ${Boolean(narration)}`, () => {
    const original = { ...source, narration };
    const before = transactionLedgerNarration(original, agency);
    const result = applyTicketMigration({ version: 2, agencies: [agency, destination], transactions: [original], activity: [] }, {
        sourceId: original.id, sourcePrice: original.amount, operationId: 'mig1',
        destination: { agencyId: 'b', date: '2026-09-28', amount: 5500000, voucher: 'V2', ticket: 'NEW', passenger: 'New passenger', narration: 'New notes' }
    }, 'Tester', '2026-09-27T02:00:00Z');
    const screen = calculateLedger(agency, result.next.transactions, '2026-09-01', '2026-09-30');
    const pdf = completeLedger(agency, result.next.transactions, '2026-09-30');
    for (const ledger of [screen, pdf]) {
        assert.equal(ledger.rows.length, 2);
        const debit = ledger.rows[0].t;
        assert.equal(debit.type, 'sale');
        assert.equal(transactionLedgerNarration(debit, agency), before);
        assert.equal(debit.narration, narration);
        assert.equal(ledger.rows[1].t.type, 'payment');
        assert.equal(transactionLedgerNarration(ledger.rows[1].t, agency), 'Ticket adjustment');
    }
});

test('ordinary payments and reversals keep their own narration', () => {
    assert.equal(transactionLedgerNarration({ ...source, type: 'payment' }, agency), 'Original notes');
    assert.equal(transactionLedgerNarration({ ...source, type: 'payment', narration: '' }, agency), 'Payment received');
    assert.equal(transactionLedgerNarration({ ...source, reversalOf: 'other', narration: 'Reversal reason' }, agency), 'Reversal reason');
});
