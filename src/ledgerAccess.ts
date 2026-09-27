// Ledger membership is issued by a trusted Firebase administrator.
export function resolveLedgerId(uid: string, claims: Record<string, unknown>): string {
    if (claims.ledgerAccess !== true && uid !== "WBQIfRwKFEeTXhS1VT8n8WgL0612") {
        throw new Error("Your account needs ledger access from your administrator.");
    }
    const shared = claims.ledgerId;
    if (shared === undefined || shared === "") return uid;
    if (claims.ledgerAccess !== true || claims.ledgerRole !== "admin" || typeof shared !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(shared)) {
        throw new Error("Your shared ledger access is invalid. Contact your administrator.");
    }
    return shared;
}
