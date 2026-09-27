import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../package.json', import.meta.url));
const cliRequire = createRequire(new URL('../package.json', import.meta.url));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const [identity, projectId, mode, sharedLedgerId] = process.argv.slice(2);
if (!identity || !projectId) { console.error('Usage: node scripts/grant-access.mjs EMAIL_OR_UID PROJECT_ID [--cli] [SHARED_LEDGER_OWNER_UID]'); process.exit(1); }
try {
    if (sharedLedgerId && !/^[A-Za-z0-9_-]{1,128}$/.test(sharedLedgerId)) throw new Error("Invalid shared ledger ID.");
    let credential = applicationDefault();
    if (mode === '--cli') {
        const cliAuth = cliRequire('firebase-tools/lib/auth.js');
        const account = cliAuth.getProjectDefaultAccount(fileURLToPath(new URL('..', import.meta.url)));
        if (!account) throw new Error('Run npx firebase login --reauth first.');
        credential = { getAccessToken: async () => {
            const token = await cliAuth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase']);
            return { access_token: token.access_token, expires_in: token.expires_in || 3600 };
        } };
    }
    const app = initializeApp({ credential, projectId });
    const auth = getAuth(app);
    const user = identity.includes('@') ? await auth.getUserByEmail(identity) : await auth.getUser(identity);
    if (sharedLedgerId) await auth.getUser(sharedLedgerId);
    const claims = { ...user.customClaims, ledgerAccess: true, ...(sharedLedgerId ? { ledgerId: sharedLedgerId, ledgerRole: "admin" } : {}) };
    await auth.setCustomUserClaims(user.uid, claims);
    const verified = await auth.getUser(user.uid);
    if (verified.customClaims?.ledgerAccess !== true || (sharedLedgerId && (verified.customClaims?.ledgerId !== sharedLedgerId || verified.customClaims?.ledgerRole !== "admin"))) throw new Error("Claim verification failed; inspect the account before retrying.");
    console.log(`Ledger access granted to ${user.email || user.uid}. Sign out and sign in again.`);
} catch (error) {
    console.error(`Access was not changed: ${error instanceof Error ? error.message : 'Administrator authentication failed.'}`);
    process.exitCode = 1;
}
