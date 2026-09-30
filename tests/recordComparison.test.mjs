import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transformWithOxc } from 'vite';
const source = await fs.readFile(new URL('../src/recordComparison.ts', import.meta.url), 'utf8');
const { code } = await transformWithOxc(source, 'recordComparison.ts');
const { sameRecord, mergeAgencyEdit } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('refresh with reordered fields does not create a false editing conflict', () => {
    const original = { id: 'a', name: 'Agency', opening: 100, active: true };
    const refreshed = { active: true, opening: 100, name: 'Agency', id: 'a' };
    assert.equal(sameRecord(refreshed, original), true);
    assert.equal(sameRecord({ ...refreshed, archivedAt: undefined }, original), true);
});

test('real edits, archiving and removed records still block stale saves', () => {
    const original = { id: 'a', name: 'Agency', opening: 100, active: true };
    for (const change of [{ name: 'Changed' }, { opening: 200 }, { active: false }, { archivedAt: '2026-09-25' }]) {
        assert.equal(sameRecord({ ...original, ...change }, original), false);
    }
    assert.equal(sameRecord(undefined, original), false);
    assert.equal(sameRecord({ id: 'a' }, original), false);
});

const agency = { id: 'a', code: 'A', name: 'Agency', contact: '', phone: '', address: '', opening: 10000, openingSide: 'Dr', active: true };
for (const active of [false, true]) {
    test(`agency status changes from ${active} to ${!active} reach the save step`, () => {
        const original = { ...agency, active };
        const submitted = { ...original, active: !active };
        const result = mergeAgencyEdit(original, original, submitted);
        assert.equal(sameRecord(original, result), false);
        assert.deepEqual(result, submitted);
        assert.equal(original.active, active);
    });
}

test('status changes preserve newer agency details and can be safely retried', () => {
    const latest = { ...agency, phone: '123', opening: 20000 };
    const submitted = { ...agency, active: false };
    const result = mergeAgencyEdit(latest, agency, submitted);
    assert.deepEqual(result, { ...latest, active: false });
    assert.deepEqual(mergeAgencyEdit(result, agency, submitted), result);
});

test('agency edits merge with unrelated changes and preserve extra record data', () => {
    const latest = { ...agency, phone: '123', active: false, metadata: { revision: 2 } };
    const result = mergeAgencyEdit(latest, agency, { ...agency, opening: 454545500 });
    assert.deepEqual(result, { ...latest, opening: 454545500 });
    assert.equal(latest.opening, 10000);
});
test('form defaults and reordered cloud fields do not cause conflicts', () => {
    const { contact, ...original } = agency;
    assert.deepEqual(mergeAgencyEdit({ ...original, contact: '' }, original, { ...agency, name: 'Updated' }), { ...agency, name: 'Updated' });
});
test('already applied edits can be safely retried', () => {
    const submitted = { ...agency, name: 'Updated', opening: 454545500 };
    assert.deepEqual(mergeAgencyEdit({ ...submitted }, agency, submitted), submitted);
});
test('conflicting edits identify the field and leave records unchanged', () => {
    const latest = { ...agency, name: 'Other edit' };
    assert.throws(() => mergeAgencyEdit(latest, agency, { ...agency, name: 'My edit' }), /Agency name changed/);
    assert.equal(latest.name, 'Other edit');
});
test('opening amount and balance side conflict as a single financial value', () => {
    assert.throws(() => mergeAgencyEdit({ ...agency, openingSide: 'Cr' }, agency, { ...agency, opening: 20000 }), /Opening balance changed/);
    assert.deepEqual(mergeAgencyEdit({ ...agency, opening: 20000 }, agency, { ...agency, name: 'Updated' }), { ...agency, opening: 20000, name: 'Updated' });
});
test('missing and archived agencies cannot be saved from an old form', () => {
    assert.throws(() => mergeAgencyEdit(undefined, agency, agency), /no longer exists/);
    assert.throws(() => mergeAgencyEdit({ ...agency, archivedAt: '2026-09-25' }, agency, agency), /archived/);
});