# Functional audit — 25 September 2026

Audit performed against the local source in F:\AGency. No production records, credentials, or deployment settings were changed. Browser data was created in a fresh, disposable Chromium context. Cloud records were saved only in Auth/Functions/Firestore emulators under demo-agency-ledger.

## Fixed

- Financial summaries hardcoded Dr for every account. They now show Dr, Cr, or neutral for zero, with an unsigned amount.
- Archive behavior disagreed across balances, reports, dashboard and older tests. Archived transactions now remain in all financial calculations and reports; archive hides operational records without reversing money. Archived agencies remain in dashboard financial totals. This follows the existing accounting audit's policy; the user was asked about the conflicting behavior and no different preference was received during the audit.
- Cloud reads and writes bypassed the existing validated callable Functions. Restored transactional readLedger/mutateLedger/importLedger calls and denied direct browser writes in Firestore rules. Server validation, revision checks, operation receipts and activity writes now apply to the UI path.
- Agency archive/restore was not supported by the server. Added these actions, archive-state checks, import support, and protection against editing archived agencies. Restore errors now appear in the UI.
- Agency deletion eligibility incorrectly ignored archived transaction history. Archived history now prevents permanent server-side deletion.
- Payment forms accepted blank required bank, cheque and mobile-wallet details. Added validation in both the form and server save path. Historical imports retain their earlier details rather than silently rewriting them.
- CSV exports corrupted names containing commas, quotation marks and line breaks. Added proper quoting and spreadsheet formula neutralization.
- Payment CSV button had no action. It now downloads matching receipts across all filtered pages.
- Agency directory PDF exported only the visible page. It now exports all matching agencies.
- Settings offered inert spreadsheet/PDF import buttons. They are now disabled and labeled unavailable. Added a JSON backup download containing agencies, transactions and activity history.
- New forms now default to an active, unarchived agency; an older entry's inactive agency remains selectable when editing.
- Updated obsolete tests that expected permanent UI deletion: current UI archive retains recoverable records and activity snapshots.

## Verification

- 54 unit/regression tests passed (accounting, local persistence, failure atomicity, duplicate vouchers, stale writes, edit conflicts, PDF values/pagination, CSV escaping, server domain and archive/restore).
- 4 Firestore rule tests passed (authorized reads; unauthorized access rejection; direct writes and audit edits rejected; private operation receipts).
- 2 Auth/Functions/Firestore integration tests passed (actual callable authorization, saves, fresh reads, history, retry deduplication, revision conflicts, agency and transaction archive/restore).
- Chromium browser test passed: agency creation, sale/payment saves, required-bank error, reload persistence, payment edit, archive/restore, credit balance rendering, ledger/receipt PDF downloads, invalid date-range handling, report CSV and JSON backup downloads, and navigation through all nine main pages. No browser page errors were observed.
- TypeScript and production build passed. Vite reports the existing large bundle warning.

Dummy reconciliation: opening BDT 100.25 Dr + sale BDT 50.15 - payment BDT 200.50 = BDT 50.10 Cr. Editing payment to BDT 200.60 yields BDT 50.20 Cr. Archive/restore preserves that balance. Both the browser workflow and fresh server reads verified these values.

## Reproduce

Run npm test and npm run build. With Java 21 available, run npm run test:rules and npm run test:integration. On this Windows machine, Functions discovery required NODE_OPTIONS=--dns-result-order=ipv4first. A portable Java runtime was placed in ignored .audit-tools/java21; it did not change the system installation or permanent PATH.

For browser tests, start Vite with VITE_DATA_BACKEND=local on 127.0.0.1:5178, then run node tests/browser-audit.mjs. The script requires Playwright (or PLAYWRIGHT_MODULE pointing to its index.mjs); CHROMIUM_PATH can select an existing browser. AUDIT_URL overrides the local test URL. Use a dedicated local-mode test server; the script uses disposable storage.

## Remaining limits and release requirements

- Changes are local and have not been deployed. Deploy the matching Functions, rules and frontend together after verifying project access. A frontend-only or rules-only release can break cloud saving if the matching callable Functions are missing.
- Production sign-in, deployed Functions availability, real records, scheduled backups, and disaster recovery were not exercised. Emulator success does not certify production configuration.
- Spreadsheet/PDF import remains unimplemented. JSON backup download is available, but there is no general file-upload restore UI. Existing browser-to-empty-cloud migration remains the supported migration path.
- Local-mode historical/corrupt browser snapshots still need a recovery workflow; local history is not tamper resistant. Cross-tab localStorage checks are not database transactions.
- Opening balances have no effective date. Editing them changes historic balances. Closed periods, reversal journals and a full double-entry general ledger are outside the current app.
- Mobile layouts, full offline/PWA lifecycle, very large production datasets, and every bank-specific receipt layout were not exhaustively tested.

## Superseding architecture update — Firestore only

At the user's request, removed Firebase Cloud Functions and moved cloud operations to direct Firestore transactions. Firebase Authentication remains. The frontend will be hosted by the user on Vercel. The previous Blaze/Functions deployment instructions are historical and superseded by FIREBASE_SETUP.md and RELEASE_STATUS.md.

Current validation evidence: 59 regression tests, 7 direct-Firestore/rules tests, and authenticated browser save/recovery/control workflows pass using only Auth and Firestore emulators. Security rules enforce ownership, atomic revision/audit commits, monetary shape, closed periods, reversal links and immutable history. Full backup validation and cross-record uniqueness remain application-domain checks; they should not be described as a trusted server validation layer. No existing production ledger data was migrated or overwritten.
