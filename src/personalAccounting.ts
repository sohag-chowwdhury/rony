export type PersonalEntry = {
    id: string; person: string; contactNumber?: string; direction: 'receivable' | 'payable';
    amount: number; paid: number; date: string; reason: string; createdAt: string; deleted?: boolean;
};
export type PersonalPayment = { id: string; amount: number; date: string; note: string };
export const PERSONAL_STORAGE_KEY = 'agency-personal-ledger-v1';
export function validatePersonalEntry(entry: PersonalEntry) {
    if (!entry.id || !entry.person.trim() || entry.person.length > 200 || !entry.reason.trim() || entry.reason.length > 4000) throw Error('Enter a name and reason.');
    if (entry.contactNumber !== undefined && (typeof entry.contactNumber !== 'string' || entry.contactNumber.length > 40)) throw Error('Contact number must be at most 40 characters.');
    if (!['receivable', 'payable'].includes(entry.direction)) throw Error('Choose whether you will receive or pay.');
    if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0 || !Number.isSafeInteger(entry.paid) || entry.paid < 0 || entry.paid > entry.amount) throw Error('Invalid amount or repayment.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || new Date(entry.date).toISOString().slice(0, 10) !== entry.date) throw Error('Enter a valid date.');
}
export function applyPersonalPayment(entry: PersonalEntry, payment: PersonalPayment): PersonalEntry {
    if (entry.deleted) throw Error('This personal entry has been deleted.');
    validatePersonalEntry(entry);
    if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0 || payment.amount > entry.amount - entry.paid) throw Error('Repayment must be positive and cannot exceed the outstanding balance.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payment.date) || new Date(payment.date).toISOString().slice(0, 10) !== payment.date || payment.date < entry.date) throw Error('Repayment date must be on or after the original date.');
    if (payment.note.length > 4000) throw Error('Note is too long.');
    return { ...entry, paid: entry.paid + payment.amount };
}
export function personalTotals(entries: PersonalEntry[]) {
    return entries.reduce((total, entry) => {
        if (entry.deleted) return total;
        validatePersonalEntry(entry);
        total[entry.direction] += entry.amount - entry.paid;
        if (!Number.isSafeInteger(total[entry.direction])) throw Error('Personal total exceeds the supported amount.');
        return total;
    }, { receivable: 0, payable: 0 });
}

export function editPersonalEntry(current: PersonalEntry, changes: PersonalEntry): PersonalEntry {
    if (current.deleted) throw Error('This personal entry has been deleted.');
    if (current.paid > 0 && changes.date !== current.date) throw Error('The original date cannot change after a repayment has been recorded.');
    if (changes.amount < current.paid) throw Error('The original amount cannot be less than the amount already repaid.');
    const updated = { ...current, person: changes.person, contactNumber: changes.contactNumber ?? current.contactNumber ?? '', direction: changes.direction, amount: changes.amount, date: changes.date, reason: changes.reason };
    validatePersonalEntry(updated);
    return updated;
}
