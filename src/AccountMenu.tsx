import { useEffect, useId, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "firebase/auth";
import { firebaseServices } from "./firebase";
import "./account-menu.css";

export default function AccountMenu({ busy = false }: { busy?: boolean }) {
    const [open, setOpen] = useState(false);
    const [signingOut, setSigningOut] = useState(false);
    const [error, setError] = useState("");
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const panelId = useId();
    const user = firebaseServices?.auth.currentUser;
    const name = user?.displayName || user?.email?.split("@")[0] || "Your account";
    const initials = name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
        const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape);
        return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
    }, [open]);
    const logout = async () => {
        if (!firebaseServices || busy || signingOut) return;
        if (!window.dispatchEvent(new Event("ledger:navigate", { cancelable: true }))) return;
        setSigningOut(true); setError("");
        try { await signOut(firebaseServices.auth); setOpen(false); }
        catch (error) { setError(error instanceof Error ? error.message : "Unable to sign out. Please try again."); }
        finally { setSigningOut(false); }
    };
    return <div className="account-menu" ref={root} onBlur={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
        <button ref={trigger} type="button" className="top-avatar" aria-label="Account options" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>{initials}</button>
        {open && <div className="account-menu-panel" id={panelId}>
            <strong>{name}</strong>
            <span>{user?.email || "Local workspace"}</span>
            <button type="button" disabled={!user || busy || signingOut} onClick={() => void logout()}><LogOut size={16} aria-hidden="true" />{signingOut ? "Signing out..." : "Sign out"}</button>
            {busy && <p role="status">Wait for your changes to finish saving.</p>}
            {error && <p role="alert">{error}</p>}
        </div>}
    </div>;
}
