# Firebase setup — Firestore + Authentication, no Functions

The browser now uses Firestore transactions directly. Firebase Cloud Functions, their emulator and their deployment target have been removed. Host the frontend on Vercel using vercel.json. No Vercel API routes or service-account secrets are needed by the deployed app.

## Vercel

1. Import this project; use the Vite framework, npm run build, output dist.
2. Add the Firebase web-app variables from .env.example to Vercel environment settings. Set VITE_DATA_BACKEND=firebase and VITE_USE_FIREBASE_EMULATORS=false.
3. Add your Vercel/custom domain to Firebase Authentication > Settings > Authorized domains.
4. Deploy the frontend. Use the updated frontend with the updated rules: older clients without atomic revision/activity writes will be rejected.

Firebase web app configuration is public client configuration. Never put Admin SDK keys or service-account JSON into VITE_ variables or the frontend.

## Firebase

Project: robins-e3132. Keep Authentication Email/Password and Firestore enabled. No Blaze upgrade is required for this architecture; normal Spark usage limits still apply.

Deploy database rules/indexes separately:

```powershell
npx firebase deploy --only firestore --project robins-e3132
```

Each authorized UID owns its ledger under ledgers/{uid}. Existing agency, transaction and activity collections remain in place. Authorize additional users with a ledgerAccess custom claim using the local admin helper:

```powershell
node scripts/grant-access.mjs USER_EMAIL_OR_UID robins-e3132 --cli
```

The admin helper uses a trusted administrator's CLI credentials locally. Firebase Admin is a development dependency for this helper and emulator tests; it is not part of the frontend and does not deploy a server.

## Persistence and protections

- Each save commits the record, immutable activity entry and next ledger revision in one Firestore transaction. Activity commits use Firestore server timestamps and authenticated actor identity.
- Consistent reads check the revision before and after reading the collections, retrying if another device changes the ledger.
- Rules enforce owner access, integer positive transaction amounts, basic record shape, agency existence, closed-period financial locks, immutable reversal links, exact bank-match amounts and immutable history/recovery documents.
- Restore writes a recovery copy and imported history in the same transaction. Existing activity is retained. Imported history is explicitly unverified.
- Full backup validation, calendar-date validation, duplicate voucher/code/bank-reference detection, aggregate precision checks and payment-method-specific requirements run in the shared client domain. They are not all independently enforceable by the current rules. This is an owner-controlled subledger, not a fully trusted server accounting service.
- Bulk restore also obeys Firestore's security-rule document-access limits. Large backups with many related agencies/reversals may require a reviewed migration even below the UI's 400-record/900 KB limits. Restore cannot erase closed-period/reversal protections. Failed restores remain atomic.

## Test

```powershell
npm test
npm run build
npm run test:rules
npm run test:integration
```

Emulator tests require Java 21. On this Windows machine use NODE_OPTIONS=--dns-result-order=ipv4first if discovery fails. Only Auth and Firestore emulators are needed. tests/browser-cloud.mjs verifies actual login and direct Firestore restore/match/close/reverse/reload flows; it requires Playwright and the two emulators.

## Password recovery

The login screen links to /forgot-password. The /reset-password page verifies
Firebase's emailed oobCode before accepting a new password. Signup is not offered.

After deploying the app:
1. Firebase Console > Authentication > Settings > Authorized domains:
   add localhost and atoz.htbyte.com (no scheme, port, or path).
2. Authentication > Templates > Password reset > Customize action URL:
   https://atoz.htbyte.com/reset-password
3. For local-only testing, temporarily use http://localhost:5173/reset-password
   as the action URL, then restore the production URL. This is a project setting,
   not automatically selected by the requesting browser.
4. Test with a real reset email. Expired or reused links must be rejected.

The sendPasswordResetEmail continue URL returns to the requesting app's origin;
it does not set the email action handler URL. Firebase may share the customized
action URL with other email templates; this page supports password reset only.
Firebase Hosting and Vercel rewrites serve both recovery routes. Other hosts must
also serve index.html for these paths.

## Shared ledger administrators

robinmia459@gmail.com and sohag02.c@gmail.com share ledger
VSTQMEI4HsZQoUcaZ1szxGlOfc32. Both ledgers were empty when checked before setup.
The accounts keep separate logins. No records need to be moved or merged.

Deploy the updated frontend and Firestore rules before issuing the shared claims:

    node scripts/grant-access.mjs robinmia459@gmail.com robins-e3132 --cli VSTQMEI4HsZQoUcaZ1szxGlOfc32
    node scripts/grant-access.mjs sohag02.c@gmail.com robins-e3132 --cli VSTQMEI4HsZQoUcaZ1szxGlOfc32

The helper preserves existing claims and verifies ledgerAccess=true,
ledgerRole=admin and ledgerId. Sign out and back in after assignment.
Claims are issued only by the trusted admin helper, never by the browser.
These admins can perform all supported ledger operations on their assigned
ledger. Financial validation, closed periods and immutable history still apply.
Every audit event keeps the authenticated actor's UID and email; ownerUid
continues to identify the ledger. Reads, writes, migrations, backups, restores
and recovery copies all use the same assigned ledger ID.
