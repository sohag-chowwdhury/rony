export type AuditEvent = {
    id: string;
    timestamp: string;
    action: "migrate" | "create" | "edit" | "delete" | "archive" | "restore" | "deactivate" | "import" | "reverse" | "reconcile" | "unreconcile" | "close";
    entity: "agency" | "transaction" | "ledger";
    entityId: string;
    label: string;
    actor: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
};
export type LedgerSnapshot<A, T> = { version: 2; agencies: A[]; transactions: T[]; activity: AuditEvent[] };
export const LEDGER_STORAGE_KEY = "aegis-ledger-v2";
type StorageAccess = Pick<Storage, "getItem" | "setItem">;
export function readLedgerSnapshot<A, T>(storage: StorageAccess, agencies: A[], transactions: T[]): LedgerSnapshot<A, T> {
    const saved = storage.getItem(LEDGER_STORAGE_KEY);
    if (saved) {
        const data = JSON.parse(saved);
        if (data.version !== 2 || !Array.isArray(data.agencies) || !Array.isArray(data.transactions) || !Array.isArray(data.activity)) throw new Error("Stored ledger is invalid. Preserve browser data before recovery.");
        return data;
    }
    return { version: 2, agencies: JSON.parse(storage.getItem("aegis-agencies") || "null") ?? agencies, transactions: JSON.parse(storage.getItem("aegis-transactions") || "null") ?? transactions, activity: [] };
}
export function persistLedger<A, T>(storage: StorageAccess, expected: string | null, snapshot: LedgerSnapshot<A, T>) {
    if (storage.getItem(LEDGER_STORAGE_KEY) !== expected) throw new Error("Records changed in another tab. Reload before saving.");
    const serialized = JSON.stringify(snapshot);
    // One storage write commits both records and their history, or neither.
    storage.setItem(LEDGER_STORAGE_KEY, serialized);
    return serialized;
}
export function makeAuditEvent(entity: AuditEvent["entity"], action: AuditEvent["action"], before: object | null, after: object | null): AuditEvent {
    const previous = before ? JSON.parse(JSON.stringify(before)) : null;
    const next = after ? JSON.parse(JSON.stringify(after)) : null;
    const record = next || previous;
    return { id: crypto.randomUUID(), timestamp: new Date().toISOString(), entity, action, entityId: record.id, label: record.voucher || record.name || record.code || record.id, actor: "Local user (not authenticated)", before: previous, after: next };
}
export function auditChanges(event: AuditEvent) {
    return [...new Set([...Object.keys(event.before || {}), ...Object.keys(event.after || {})])]
        .filter(key => JSON.stringify(event.before?.[key]) !== JSON.stringify(event.after?.[key]))
        .map(key => ({ field: key, before: event.before?.[key], after: event.after?.[key] }));
}
export function changeArchive<T extends { archivedAt?: string; status: string }>(record: T, archived: boolean): T {
    if (Boolean(record.archivedAt) === archived) throw new Error(archived ? "This entry is already archived." : "This entry is already active.");
    const next = { ...record, status: "pending" };
    if (archived) next.archivedAt = new Date().toISOString();
    else delete next.archivedAt;
    return next;
}
