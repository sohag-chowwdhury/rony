import type { Snapshot } from '../ledgerControls';
import type { AuditEvent } from '../history';
import type { Agency, Transaction } from '../App';
export function applyMutation(snapshot: Snapshot, command: { entity: string; action: string; id: string; record: unknown; operationId: string }, actor: string, timestamp: string): { next: Snapshot; event: AuditEvent; after: Agency | Transaction | null };

export function applyTicketMigration(snapshot: Snapshot, request: {sourceId: string; sourcePrice: number; destination: Partial<Transaction>; operationId: string}, actor: string, timestamp: string, options?: {legacyCloud?: boolean}): {next: Snapshot; event: AuditEvent; after: Transaction; credit: Transaction; sale: Transaction};
