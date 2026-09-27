import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { onAuthStateChanged, signInWithEmailAndPassword, type User } from "firebase/auth";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { readDirectLedger, mutateDirectLedger, restoreDirectLedger } from "./directLedger";
import { firebaseConfigurationError, firebaseServices } from "./firebase";
import AccountMenu from "./AccountMenu";
import { LEDGER_STORAGE_KEY, readLedgerSnapshot, type AuditEvent, type LedgerSnapshot } from "./history";
import type { Agency, Transaction } from "./App";
export type CloudSnapshot = LedgerSnapshot<Agency, Transaction> & { revision: number };
type CloudContextValue = { recovery: () => Promise<LedgerSnapshot<Agency,Transaction>>; restore: (snapshot: LedgerSnapshot<Agency,Transaction>, revision: number) => Promise<CloudSnapshot>; snapshot: CloudSnapshot; busy: boolean; refresh: () => Promise<void>; mutate: (event: AuditEvent, revision: number) => Promise<CloudSnapshot> };
const CloudContext = createContext<CloudContextValue | null>(null);
export const useCloudLedger = () => useContext(CloudContext);
const directLedgerAccessUids = new Set(["WBQIfRwKFEeTXhS1VT8n8WgL0612"]);
const message = (error: unknown) => error instanceof Error ? error.message : "Unable to contact Firebase.";
export default function FirebaseGate({ children }: { children: ReactNode }) {
    const [showPassword, setShowPassword] = useState(false);
    const [user, setUser] = useState<User | null>(null), [loading, setLoading] = useState(Boolean(firebaseServices));
    const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [error, setError] = useState(""), [submitting, setSubmitting] = useState(false);
    useEffect(() => firebaseServices ? onAuthStateChanged(firebaseServices.auth, next => { setUser(next); setLoading(false); }, error => { setError(message(error)); setLoading(false); }) : undefined, []);
    if (firebaseConfigurationError) return <AuthShell><h1>Firebase setup required</h1><p role="alert">{firebaseConfigurationError}</p></AuthShell>;
    if (!firebaseServices) return <><div className="firebase-banner">Local mode · Firebase is not configured</div>{children}</>;
    if (loading) return <AuthShell><p role="status">Checking your session…</p></AuthShell>;
    if (user) return <CloudSession key={user.uid} user={user}>{children}</CloudSession>;
    return <AuthShell><div className="auth-heading"><span className="auth-eyebrow">YOUR AGENCY WORKSPACE</span><h1>Welcome back</h1><p>Sign in to manage your accounts and receipts.</p></div><form onSubmit={async event => {
        event.preventDefault(); if (submitting) return; setSubmitting(true); setError("");
        try { await signInWithEmailAndPassword(firebaseServices!.auth, email.trim(), password); setPassword(""); }
        catch (error) { setError(message(error)); } finally { setSubmitting(false); }
    }}>
        <label htmlFor="login-email">Email address</label>
        <div className="auth-input"><Mail size={18} aria-hidden="true" /><input id="login-email" type="email" required autoComplete="username" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} /></div>
        <label htmlFor="login-password">Password</label>
        <div className="auth-input"><LockKeyhole size={18} aria-hidden="true" /><input id="login-password" type={showPassword ? "text" : "password"} required autoComplete="current-password" placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} /><button className="auth-password-toggle" type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="primary-button auth-submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}<ArrowRight size={18} aria-hidden="true" /></button>
    </form><p className="auth-help">Need access? Contact your administrator.</p></AuthShell>;
}
function AuthShell({ children }: { children: ReactNode }) {
    return <main className="firebase-login"><div className="auth-layout"><div className="auth-brand"><img src="/az-air-travels-logo.png" alt="A TO Z AIR TRAVELS" /><span>A TO Z <strong>AIR TRAVELS</strong></span></div><section className="auth-card">{children}</section><p className="auth-footer">Agency accounts · Payments · Ledgers</p></div></main>;
}
function CloudSession({ user, children }: { user: User; children: ReactNode }) {
    const services = firebaseServices!;
    const [snapshot, setSnapshot] = useState<CloudSnapshot | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [online, setOnline] = useState(navigator.onLine);

    const accessMessage = `The account ${user.email || user.uid} needs ledger access from your administrator. After access is granted, sign out and sign in again.`;
    const inFlight = useRef(false), mounted = useRef(true), requestNumber = useRef(0);
    const accept = (next: CloudSnapshot) => { if (mounted.current) setSnapshot(current => !current || next.revision >= current.revision ? next : current); };
    const readCloudSnapshot = () => readDirectLedger(services.db,user.uid);
    const refresh = async () => {
        const request = ++requestNumber.current;
        try {
            const token = await user.getIdTokenResult();
            if (token.claims.ledgerAccess !== true && !directLedgerAccessUids.has(user.uid)) throw new Error(accessMessage);
            const next = await readCloudSnapshot();
            if (mounted.current && request === requestNumber.current) { accept(next); setError(""); }
        } catch (error) { if (mounted.current) setError(message(error)); throw error; }
    };
    useEffect(() => {
        mounted.current = true;
        let active = true;
        let unsubscribe = () => { };
        void user.getIdTokenResult(true).then(token => {
            if (!active) return;
            if (token.claims.ledgerAccess !== true && !directLedgerAccessUids.has(user.uid)) { setError(accessMessage); return; }
            unsubscribe = onSnapshot(doc(services.db, "ledgers", user.uid), () => { void refresh().catch(() => { }); }, error => setError(message(error)));
        }).catch(error => { if (active) setError(message(error)); });
        const on = () => { setOnline(true); void refresh().catch(() => { }); }, off = () => setOnline(false);
        window.addEventListener("online", on); window.addEventListener("offline", off);
        return () => { active = false; mounted.current = false; unsubscribe(); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
    }, [user.uid]);
    const mutate = async (event: AuditEvent, revision: number) => {
        if (!navigator.onLine) throw new Error("You are offline. Reconnect before saving financial changes.");
        if (inFlight.current) throw new Error("A change is already being saved. Wait for confirmation.");
        inFlight.current = true; setBusy(true);
        try {
            const nextSnapshot = await mutateDirectLedger(services.db,user,event,revision);
            accept(nextSnapshot); setError(""); return nextSnapshot;
        } catch (error) { void refresh().catch(() => { }); throw error; }
        finally { inFlight.current = false; if (mounted.current) setBusy(false); }
    };
    const restore = async (data: LedgerSnapshot<Agency,Transaction>, revision: number) => {
        if(!navigator.onLine)throw Error("Reconnect before restoring a backup.");
        if(inFlight.current)throw Error("Wait for the current save to finish.");
        inFlight.current=true;setBusy(true);
        try { const next=await restoreDirectLedger(services.db,user,data,revision);accept(next);setError("");return next; }
        catch(error){void refresh().catch(()=>{});throw error;}
        finally{inFlight.current=false;if(mounted.current)setBusy(false);}
    };
    const recovery = async () => {
        const result=await getDocs(query(collection(services.db,"ledgers",user.uid,"recovery"),orderBy("createdAt","desc"),limit(1)));
        if(result.empty)throw Error("No pre-restore recovery copy is available.");
        return result.docs[0].data().snapshot as LedgerSnapshot<Agency,Transaction>;
    };
    const exportLocal = () => {
        try {
            const data = readLedgerSnapshot<Agency, Transaction>(localStorage, [], []);
            const link = document.createElement("a"), url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
            link.href = url; link.download = `local-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) { setError(message(error)); }
    };
    const importLocal = async () => {
        if (inFlight.current) return;
        inFlight.current = true; setBusy(true);
        try {
            const local = readLedgerSnapshot<Agency, Transaction>(localStorage, [], []);
            if (!local.agencies.length && !local.transactions.length) throw new Error("No saved local records to import.");
            const data = { snapshot: local, operationId: crypto.randomUUID() };
            const imported = await restoreDirectLedger(services.db,user,data.snapshot,0,data.operationId,true);
            accept(imported); setError("");
        } catch (error) { setError(message(error)); }
        finally { inFlight.current = false; if (mounted.current) setBusy(false); }
    };
    const hasLocal = Boolean(localStorage.getItem(LEDGER_STORAGE_KEY) || localStorage.getItem("aegis-agencies") || localStorage.getItem("aegis-transactions"));
    return <>{!snapshot && <div className="account-recovery-bar"><AccountMenu busy={busy} /></div>}
        {error && <p className="firebase-error" role="alert">{error}</p>}
        {!snapshot ? <p className="archive-empty">{error ? "Unable to load your cloud ledger. Check account access and deployment, then refresh." : "Loading cloud ledger…"}</p> : <>
            {snapshot.revision === 0 && hasLocal && <section className="firebase-migration"><h2>Existing local ledger found</h2><p>Your cloud ledger is empty. Download a local backup, then import the saved records and history into this signed-in account. Local records will remain on this device.</p><button onClick={exportLocal}>Download local backup</button><button disabled={busy || !online} onClick={() => { void importLocal(); }}>Import local ledger into {user.email}</button></section>}
            <CloudContext.Provider value={{ snapshot, mutate, busy, refresh, restore, recovery }}>{children}</CloudContext.Provider>
        </>}
    </>;
}
