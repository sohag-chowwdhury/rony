import type { Agency } from "./App";
// Ledger records contain scalar fields. Compare values independently of key order.
export function sameRecord<T extends object>(current: T | undefined, original: T): boolean {
    if (!current) return false;
    const keys = new Set([...Object.keys(current), ...Object.keys(original)]);
    return [...keys].every(key => current[key as keyof T] === original[key as keyof T]);
}

// Apply only the form's edits to the latest record. Preserve unrelated updates.
export function mergeAgencyEdit(current: Agency | undefined, original: Agency, submitted: Agency): Agency {
    if (!current || current.id !== original.id || submitted.id !== original.id) {
        throw new Error("This agency no longer exists. Close the form and refresh the directory.");
    }
    if (current.archivedAt) throw new Error("This agency was archived. Restore it before editing.");
    const next = { ...current };
    const fields = ["code", "name", "contact", "phone", "address"] as const;
    const labels = { code: "Agency code", name: "Agency name", contact: "Contact person", phone: "Mobile number", address: "Address" };
    for (const field of fields) {
        const before = original[field] ?? "", latest = current[field] ?? "", edited = submitted[field] ?? "";
        if (edited === before) continue;
        if (latest !== before && latest !== edited) {
            throw new Error(labels[field] + " changed while you were editing. Your edits are still in the form. Copy them before reopening the agency.");
        }
        next[field] = edited;
    }
    // Amount and Dr/Cr side are one value; merging them separately could change its meaning.
    const sameOpening = (a: Agency, b: Agency) => a.opening === b.opening && a.openingSide === b.openingSide && a.openingDate === b.openingDate;
    if (!sameOpening(submitted, original)) {
        if (!sameOpening(current, original) && !sameOpening(current, submitted)) {
            throw new Error("Opening balance changed while you were editing. Your edits are still in the form. Copy them before reopening the agency.");
        }
        next.opening = submitted.opening;
        next.openingSide = submitted.openingSide;
        if(submitted.openingDate) next.openingDate = submitted.openingDate; else delete next.openingDate;
    }
    return next;
}