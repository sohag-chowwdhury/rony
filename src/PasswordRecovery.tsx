import { useEffect, useRef, useState, type FormEvent } from "react";
import { confirmPasswordReset, sendPasswordResetEmail, verifyPasswordResetCode, type Auth } from "firebase/auth";

function recoveryError(error: unknown): string {
    const code = (error as { code?: string })?.code;
    if (code === "auth/expired-action-code" || code === "auth/invalid-action-code") return "This reset link has expired or has already been used. Request a new link.";
    if (code === "auth/weak-password" || code === "auth/password-does-not-meet-requirements") return "Choose a stronger password that meets your account password policy.";
    if (code === "auth/too-many-requests") return "Too many attempts. Please try again later.";
    if (code === "auth/network-request-failed") return "Check your connection and try again.";
    return "Unable to complete password recovery. Please try again or contact your administrator.";
}

export default function PasswordRecovery({ auth }: { auth: Auth }) {
    const reset = window.location.pathname.replace(/\/$/, "") === "/reset-password";
    const [link] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return { code: params.get("oobCode") || "", mode: params.get("mode") };
    });
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [checking, setChecking] = useState(reset);
    const [verified, setVerified] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [done, setDone] = useState(false);
    const pending = useRef(false);

    useEffect(() => {
        if (!reset) return;
        let active = true;
        if (link.mode !== "resetPassword" || !link.code) {
            setError("Open the reset link from your email, or request a new link.");
            setChecking(false);
            return;
        }
        void verifyPasswordResetCode(auth, link.code).then(address => {
            if (active) { setEmail(address); setVerified(true); }
        }).catch(reason => { if (active) setError(recoveryError(reason)); })
            .finally(() => { if (active) setChecking(false); });
        return () => { active = false; };
    }, [auth, link, reset]);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (pending.current || done || (reset && !verified)) return;
        setError("");
        if (reset && password !== confirmation) { setError("Passwords do not match."); return; }
        pending.current = true;
        setBusy(true);
        try {
            if (reset) {
                await confirmPasswordReset(auth, link.code, password);
                setPassword(""); setConfirmation("");
                window.history.replaceState(null, "", "/reset-password");
            } else {
                try {
                    await sendPasswordResetEmail(auth, email.trim(), { url: window.location.origin + "/" });
                } catch (reason) {
                    // Do not disclose whether an account exists.
                    if (!["auth/user-not-found", "auth/user-disabled"].includes((reason as { code?: string }).code || "")) throw reason;
                }
            }
            setDone(true);
        } catch (reason) { setError(recoveryError(reason)); }
        finally { pending.current = false; setBusy(false); }
    }

    return <>
        <div className="auth-heading"><h1>{reset ? "Reset password" : "Forgot password?"}</h1><p>{reset ? "Choose a new password for your account." : "Enter your account email to request a reset link."}</p></div>
        {checking && <p role="status">Checking your reset link...</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {done ? <p role="status">{reset ? "Password updated. You can now sign in with your new password." : "If this email has an eligible account, a reset link has been sent. Check your inbox and spam folder."}</p> : !checking && (!reset || verified) && <form onSubmit={submit}>
            <label htmlFor="recovery-email">Email address</label>
            <div className="auth-input"><input id="recovery-email" type="email" autoComplete="email" required readOnly={reset} disabled={busy} value={email} onChange={event => setEmail(event.target.value)} /></div>
            {reset && <>
                <label htmlFor="new-password">New password</label>
                <div className="auth-input"><input id="new-password" type="password" autoComplete="new-password" minLength={6} required disabled={busy} value={password} onChange={event => setPassword(event.target.value)} /></div>
                <label htmlFor="confirm-password">Confirm new password</label>
                <div className="auth-input"><input id="confirm-password" type="password" autoComplete="new-password" minLength={6} required disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></div>
            </>}
            <button className="primary-button auth-submit" disabled={busy}>{busy ? "Please wait..." : reset ? "Save new password" : "Send reset link"}</button>
        </form>}
        {reset && !done && <p className="auth-help"><a href="/forgot-password">Request a new reset link</a></p>}
        <p className="auth-help"><a href="/">Back to sign in</a></p>
    </>;
}