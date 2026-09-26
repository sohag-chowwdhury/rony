import type { Snapshot } from '../ledgerControls';
import type { AuditEvent } from '../history';
import type { Agency, Transaction } from '../App';
export function applyMutation(snapshot: Snapshot, command: { entity: string; action: string; id: string; record: unknown; operationId: string }, actor: string, timestamp: string): { next: Snapshot; event: AuditEvent; after: Agency | Transaction | null };
