import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRecord, applyMutation } from '../src/shared/ledger-domain.mjs';
import { validateBackup } from '../src/shared/ledgerControls.mjs';

const agency = { id: 'a', code: 'A', name: 'Agency', active: true, opening: 0, openingSide: 'Dr' };
const sale = { id: 's', type: 'sale', agencyId: 'a', date: '2026-09-28', voucher: 'V1', ticket: 'T1', passenger: 'Passenger', amount: 120000, ticketCost: 100000, createdAt: '2026-09-28T12:00:00Z', status: 'synced' };

test('airline selection survives save, edit and backup restore', () => {
    const saved = cleanRecord('transaction', { ...sale, airlineCode: 'BG', airlineName: 'Biman Bangladesh Airlines' });
    assert.equal(saved.airlineCode, 'BG');
    assert.equal(saved.airlineName, 'Biman Bangladesh Airlines');
    const changed = applyMutation({ agencies: [agency], transactions: [saved], activity: [] }, {
        entity: 'transaction', action: 'edit', id: 's', operationId: 'edit1',
        record: { ...saved, airlineCode: 'OTHER', airlineName: 'Custom Airline' }
    }, 'tester', '2026-09-28T13:00:00Z').after;
    const restored = validateBackup({ version: 2, agencies: [agency], transactions: [changed], activity: [] });
    assert.equal(restored.transactions[0].airlineCode, 'OTHER');
    assert.equal(restored.transactions[0].airlineName, 'Custom Airline');
    assert.equal(restored.transactions[0].amount, sale.amount);
});

test('historical tickets without airline fields remain valid and invalid airline values are rejected', () => {
    assert.equal(cleanRecord('transaction', sale).airlineCode, undefined);
    for (const airlineName of [42, {}, 'x'.repeat(4001)]) {
        assert.throws(() => cleanRecord('transaction', { ...sale, airlineName }));
        assert.throws(() => validateBackup({ version: 2, agencies: [agency], transactions: [{ ...sale, airlineName }], activity: [] }));
    }
});