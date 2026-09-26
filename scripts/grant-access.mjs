import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../package.json', import.meta.url));
const cliRequire = createRequire(new URL('../package.json', import.meta.url));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const [identity, projectId, mode] = process.argv.slice(2);
if (!identity || !projectId) { console.error('Usage: node scripts/grant-access.mjs EMAIL_OR_UID PROJECT_ID [--cli]'); process.exit(1); }
try {
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
    await auth.setCustomUserClaims(user.uid, { ...user.customClaims, ledgerAccess: true });
    console.log(`Ledger access granted to ${user.email || user.uid}. Sign out and sign in again.`);
} catch (error) {
    console.error(`Access was not changed: ${error instanceof Error ? error.message : 'Administrator authentication failed.'}`);
    process.exitCode = 1;
}
