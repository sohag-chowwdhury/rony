> Update: Firebase code, server validation, authentication gate and rules have now been added. Live deployment is not verified. See FIREBASE_SETUP.md for current setup and test status. The original local-mode review below remains relevant when local mode is used.

# Debit / credit integrity review

Reviewed: 2026-09-24

## Result

The agency receivables convention is correct: signed opening balance + ticket sales - payments. Positive balances are Dr (receivable), negative balances are Cr (agency advance), and zero is neutral. This is an agency subledger, not a complete double-entry accounting system.

31 regression tests pass with `npm test`. TypeScript and production build pass with `npm run build`. This does not certify production readiness or the correctness of existing browser-held records.

## Corrected

- Parse decimal amounts into integer minor units without floating-point rounding. Reject negative, zero transaction amounts, non-numeric, excessive decimal precision and unsafe numbers; allow zero opening balances.
- Share the same date-range calculation between the ledger table, summary and PDF input. Include earlier transactions in period opening; include both date boundaries; use deterministic same-day ordering. Hide totals for invalid date ranges.
- Validate agency references and reject duplicate IDs/vouchers on add, including immediate repeated submission. Edits exclude their own voucher from duplicate checks. Generated vouchers now include a UUID suffix.
- Reject deletion of agencies with opening balances or any transaction history. Reject duplicate agency codes and invalid opening amounts.
- Write browser storage before updating UI state or reporting success. Storage failures propagate to the form. Detect already-changed storage in another tab and reject the stale write. This check is not a transactional cross-tab locking guarantee.
- Mark new/edited entries pending instead of claiming server confirmation. Remove the fake timer-based sync success; explain that no server sync is configured. Historical 'synced' flags display as unverified.
- Replace the auxiliary IndexedDB queue snapshot after changes so edits/deletes do not leave stale queued copies. Browser-level IndexedDB failure/recovery behavior was not exercised by the Node regression tests.
- Receipt amount words include paisa and support large amounts; wrap words in their allotted PDF area. Ledger PDF zero balances use a neutral side.
- Remove fixed report date/month labels from totals that include all records.

## Coverage

Exact decimals, invalid monetary inputs, partial payment, exact settlement, overpayment, credit opening, prior-period opening, date boundaries, same-day order, payment edit/delete, agency reassignment, empty periods, invalid ranges, duplicate vouchers/submissions, invalid agency references, deletion restrictions, paisa wording, overflow, and 1,000-entry reconciliation. Store-function tests simulate browser storage failure and stale-tab writes. PDF tests check multi-page entry output, monetary values, zero side and page totals.

## Outstanding production risks

1. No backend accounting API, durable server database, real synchronization or verified backups. Records currently depend on this browser's localStorage; IndexedDB is an auxiliary queue. Clearing browser data can lose records. Import/backup UI is not a tested recovery system.
2. No authentication or server-enforced permissions; ADMIN is display text. Browser-side controls do not establish financial authorization.
3. Transaction and agency changes now have a local before/after activity log committed with the records. It is not a server-enforced immutable audit trail; reversal workflows and closed-period controls are still absent. Changing an opening balance changes all historical computed balances. Opening balances have no effective date; they are assumed to precede all stored transactions.
4. Existing localStorage data is not schema-migrated/validated at load; corrupt JSON or historical invalid/orphaned records require a recovery workflow. The user's actual browser records were not accessed or reconciled against source documents during this code review. Do not automatically rewrite historic financial data.
5. Cross-tab preflight checks reduce accidental overwrites but do not replace database transactions, optimistic concurrency versions or server idempotency.
6. Fresh storage loads demo records. A real-data onboarding process must explicitly handle these; no existing records were reset or deleted in this review.
7. No complete double-entry journal, bank reconciliation, independently verified opening balances, or accounting-period close. Currency is BDT only.

Before operational use, implement the server-backed persistence/authentication/audit/recovery layer and reconcile opening balances and actual transactions against source records.

## Archive and activity history update

- Ticket Sales and Payment Receipts now offer Archive. The Archive page restores the same entry ID without duplicating its amount.
- Archived transactions remain in the general ledger, financial reports and all balance calculations. Only the active operational lists hide them. Archived entries must be restored before editing.
- Create, edit, delete, archive, restore and agency-deactivation events retain timestamped before/after snapshots. Activity Log displays Bangladesh date/time to the second and searchable changed values. Deletion still removes the financial effect; its old values remain in history.
- Records and activity are committed in one localStorage document (`aegis-ledger-v2`). Existing agency/transaction keys are read on first migration and left untouched as legacy copies. After migration the new document is authoritative.
- History begins with new actions after this update; previous edits/deletions cannot be reconstructed. Actor is explicitly shown as an unauthenticated local user. Browser storage can be edited or cleared; this feature does not add server backup or tamper resistance.
- Added regression coverage for balance preservation during archive/restore, history contents, failed-write atomicity, legacy migration and agency-change history.
## Functional re-audit — 2026-09-25

See [AUDIT_REPORT.md](AUDIT_REPORT.md) for the current findings and evidence. The current UI archives instead of permanently deleting records. Archived financial records remain included in balances and reports. The re-audit fixed the cloud-path/rules regression and verified 54 regression tests, 6 emulator tests, browser save/reload workflows and the production build. Changes have not been deployed.
