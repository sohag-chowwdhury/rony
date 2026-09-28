import { createPortal } from "react-dom";
import { applyTicketMigration } from "./shared/ledger-domain.mjs";
import type { MigrationRequest } from "./directLedger";
import { agencyContactLinks } from "./agencyContact";
import { transactionLedgerNarration } from "./accounting";
import { Phone, MessageCircle } from "lucide-react";
import { validateOpening, protectTransaction, makeReversal, validateMatch, validateBackup } from "./ledgerControls";
import { LedgerTools } from "./LedgerTools";
import InstallGuide from "./InstallGuide";
import AccountMenu from "./AccountMenu";
import PersonalLedger from "./PersonalLedgerPage";
import { useFormSafety } from "./useFormSafety";
import { AirlineSelect } from "./AirlineSelect";
import { AgencySelect } from "./AgencySelect";
import { encodeCsv } from "./csv";
import { mergeAgencyEdit, sameRecord } from "./recordComparison";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    Activity,
    Archive,
    RotateCcw,
    AlertTriangle,
    ArrowDownLeft,
    ArrowUpRight,
    BarChart3,
    Bell,
    BookOpen,
    Building2,
    CalendarDays,
    Check,
    ChevronRight,
    CircleDollarSign,
    Cloud,
    CloudOff,
    Download,
    FileBarChart,
    FileSpreadsheet,
    Filter,
    HelpCircle,
    Landmark,
    LayoutDashboard,
    Menu,
    MoreHorizontal,
    Plus,
    Receipt,
    RefreshCw,
    Search,
    Settings as SettingsIcon,
    ShieldCheck,
    Ticket,
    TrendingDown,
    TrendingUp,
    Upload,
    Users,
    Wallet,
    X,
} from "lucide-react";
import { isTaxRefund, validatePaymentDetails, parseMoney, assertMinor, getBalance, balanceMeta, calculateLedger, validateEntry, amountInWords, ticketProfit, profitSummary, ledgerDateWindow, completeLedger, activeLedgerRecords, compareLedgerEntries, outgoingMigration, ticketHistory, originalTicketCost } from "./accounting";
import { readLedgerSnapshot, persistLedger, makeAuditEvent, auditChanges, changeArchive, LEDGER_STORAGE_KEY, type AuditEvent } from "./history";
import { useCloudLedger } from "./FirebaseGate";
import { firebaseServices } from "./firebase";
import type { LedgerSnapshot } from "./history";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { createLedgerPdf, type StatementData } from "./LedgerStatement";

type Page =
    | "dashboard"
    | "personal"
    | "agencies"
    | "sales"
    | "payments"
    | "ledger"
    | "reports"
    | "settings"
    | "install"
    | "archive"
    | "activity"
    | "reconciliation";
type TxType = "sale" | "payment";
type SyncStatus = "synced" | "pending" | "failed";

export type Agency = {
    id: string;
    code: string;
    name: string;
    contact: string;
    phone: string;
    address: string;
    opening: number;
    openingSide: "Dr" | "Cr";
    openingDate?: string;
    closedThrough?: string;
    active: boolean;
    archivedAt?: string;
};
export type Transaction = {
    id: string;
    type: TxType;
    nextMigration?: Transaction['migration'];
    migration?: { rootId?: string; id: string; sourceId: string; creditId: string; saleId: string; fromAgencyId: string; toAgencyId: string; sourcePrice: number; sellingPrice: number; createdAt: string };
    reversalOf?: string;
    reconciliation?: { bankAccount: string; bankReference: string; date: string; amount: number };
    agencyId: string;
    date: string;
    voucher: string;
    reference?: string;
    ticket?: string;
    passenger?: string;
    sector?: string;
    flightDate?: string;
    airlineCode?: string;
    airlineName?: string;
    amount: number;
    ticketCost?: number;
    method?: string;
    bank?: string;
    sendingBank?: string;
    receivingBank?: string;
    sendingBankName?: string;
    receivingBankName?: string;
    chequeNumber?: string;
    chequeDate?: string;
    walletNumber?: string;
    narration?: string;
    status: SyncStatus;
    createdAt: string;
    archivedAt?: string;
};

type FormMode = "sale" | "payment" | "agency" | null;

const demoAgencies: Agency[] = [
    {
        id: "agency-1",
        code: "EWT-001",
        name: "EAST WEST TRADE",
        contact: "Mahmud Hasan",
        phone: "+880 1711 223344",
        address: "Gulshan-1, Dhaka",
        opening: 23014200,
        openingSide: "Dr",
        active: true,
    },
    {
        id: "agency-2",
        code: "SKY-014",
        name: "Skyline Travels",
        contact: "Nusrat Jahan",
        phone: "+880 1812 778899",
        address: "Banani, Dhaka",
        opening: 4850000,
        openingSide: "Dr",
        active: true,
    },
    {
        id: "agency-3",
        code: "TRP-008",
        name: "Trip Pearl",
        contact: "Fahim Rahman",
        phone: "+880 1911 440022",
        address: "Agrabad, Chattogram",
        opening: 1250000,
        openingSide: "Cr",
        active: true,
    },
    {
        id: "agency-4",
        code: "NEX-022",
        name: "Nexus Air Services",
        contact: "Sadia Karim",
        phone: "+880 1610 554433",
        address: "Uttara, Dhaka",
        opening: 0,
        openingSide: "Dr",
        active: false,
    },
];
const demoTransactions: Transaction[] = [
    {
        id: "tx-1",
        type: "sale",
        agencyId: "agency-1",
        date: "2026-09-19",
        voucher: "V-260919-084",
        reference: "REF-90312",
        ticket: "ET-220349201",
        passenger: "Rafiq Ahmed",
        sector: "DAC - DXB",
        flightDate: "2026-10-02",
        amount: 6850000,
        narration: "Emirates return",
        status: "synced",
        createdAt: "2026-09-19T10:20:00Z",
    },
    {
        id: "tx-2",
        type: "payment",
        agencyId: "agency-1",
        date: "2026-09-20",
        voucher: "RC-260920-031",
        reference: "NBL-88392",
        amount: 5000000,
        method: "Bank transfer",
        bank: "National Bank",
        narration: "Part payment",
        status: "synced",
        createdAt: "2026-09-20T08:30:00Z",
    },
    {
        id: "tx-3",
        type: "sale",
        agencyId: "agency-2",
        date: "2026-09-21",
        voucher: "V-260921-102",
        reference: "REF-90441",
        ticket: "ET-220349415",
        passenger: "Sanjida Chowdhury",
        sector: "DAC - BKK",
        flightDate: "2026-10-08",
        amount: 3240000,
        narration: "Thai Airways",
        status: "synced",
        createdAt: "2026-09-21T11:12:00Z",
    },
    {
        id: "tx-4",
        type: "payment",
        agencyId: "agency-3",
        date: "2026-09-22",
        voucher: "RC-260922-009",
        reference: "BKASH-7741",
        amount: 1800000,
        method: "Online transfer",
        narration: "Advance deposit",
        status: "synced",
        createdAt: "2026-09-22T09:40:00Z",
    },
    {
        id: "tx-5",
        type: "sale",
        agencyId: "agency-1",
        date: "2026-09-23",
        voucher: "V-260923-011",
        reference: "REF-90506",
        ticket: "ET-220349882",
        passenger: "Tania Islam",
        sector: "DAC - SIN",
        flightDate: "2026-10-15",
        amount: 7125000,
        narration: "Singapore Airlines",
        status: "pending",
        createdAt: "2026-09-23T07:30:00Z",
    },
];

const bangladeshBanks = [
    "Sonali Bank PLC", "Janata Bank PLC", "Agrani Bank PLC", "Rupali Bank PLC",
    "City Bank PLC", "BRAC Bank PLC", "Dutch-Bangla Bank PLC", "Eastern Bank PLC",
    "Bank Asia PLC", "IFIC Bank PLC", "Prime Bank PLC", "Pubali Bank PLC",
    "Dhaka Bank PLC", "Mutual Trust Bank PLC", "NCC Bank PLC", "National Bank PLC",
    "Southeast Bank PLC", "United Commercial Bank PLC", "Trust Bank PLC", "Uttara Bank PLC",
    "Islami Bank Bangladesh PLC", "Al-Arafah Islami Bank PLC", "Shahjalal Islami Bank PLC",
    "EXIM Bank PLC", "Standard Chartered Bank", "HSBC Bangladesh", "Other Bank",
];

const money = (minor: number) =>
    `BDT ${(Math.abs(minor) / 100).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const getToday = () => {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Dhaka",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((item) => item.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
};
const createVoucher = (prefix: "V" | "RC", date: string) => {
    const compactDate = date.replace(/-/g, "").slice(2);
    const sequence = String(Math.floor(100 + Math.random() * 900));
    return `${prefix}-${compactDate}-${sequence}-${crypto.randomUUID().slice(0, 8)}`;
};
const id = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createChallengeCode = () => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
};
const offlineDb = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("aegis-ledger-offline", 1);
        request.onupgradeneeded = () =>
            request.result.createObjectStore("pending-transactions", {
                keyPath: "id",
            });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
function useLedgerStore() {
    const cloud = useCloudLedger();
    const [snapshot, setSnapshot] = useState<LedgerSnapshot<Agency, Transaction> & { revision?: number }>(() => cloud?.snapshot || readLedgerSnapshot(localStorage, demoAgencies, demoTransactions));
    const { agencies, transactions, activity } = snapshot;
    const current = useRef(snapshot);
    const disk = useRef(localStorage.getItem(LEDGER_STORAGE_KEY));
    const legacyDisk = useRef({ agencies: localStorage.getItem("aegis-agencies"), transactions: localStorage.getItem("aegis-transactions") });
    useEffect(() => {
        if (cloud?.snapshot && (cloud.snapshot.revision >= (current.current.revision || 0))) {
            current.current = cloud.snapshot;
            setSnapshot(cloud.snapshot);
        }
    }, [cloud?.snapshot]);
    const commit = (nextAgencies: Agency[], nextTransactions: Transaction[], event: AuditEvent) => {
        if (cloud) {
            return cloud.mutate(event, current.current.revision || 0).then(next => {
                if (next.revision >= (current.current.revision || 0)) { current.current = next; setSnapshot(next); }
            });
        }
        if (localStorage.getItem("aegis-agencies") !== legacyDisk.current.agencies || localStorage.getItem("aegis-transactions") !== legacyDisk.current.transactions) throw new Error("Records changed in another tab. Reload before saving.");
        const next = { version: 2 as const, agencies: nextAgencies, transactions: nextTransactions, activity: [...current.current.activity, event] };
        disk.current = persistLedger(localStorage, disk.current, next);
        current.current = next;
        setSnapshot(next);
    };
    const migrate = async (request: MigrationRequest) => {
        if (cloud) {
            const next = await cloud.migrate(request, current.current.revision || 0);
            if (next.revision >= (current.current.revision || 0)) { current.current=next;setSnapshot(next); }
        } else {
            const result=applyTicketMigration(current.current,request,"Local user",new Date().toISOString());
            await commit(result.next.agencies,result.next.transactions,result.event);
        }
    };
    const add = (tx: Transaction) => {
        protectTransaction(current.current, null, tx);
        validateEntry(tx, current.current.agencies, current.current.transactions);
        const next: Transaction = { ...tx, voucher: tx.voucher.trim(), status: "pending" };
        return commit(current.current.agencies, [...current.current.transactions, next], makeAuditEvent("transaction", "create", null, next));
    };
    const validateAgency = (agency: Agency) => {
        validateOpening(agency, current.current.agencies.find(a=>a.id===agency.id), current.current.transactions);
        assertMinor(agency.opening, true);
        if (!agency.code.trim() || !agency.name.trim()) throw new Error("Agency code and name are required.");
        if (current.current.agencies.some(item => item.id !== agency.id && item.code.trim().toLowerCase() === agency.code.trim().toLowerCase())) throw new Error("Agency code already exists.");
        getBalance(agency, current.current.transactions);
    };
    const addAgency = (agency: Agency) => {
        validateAgency(agency);
        if (current.current.agencies.some(item => item.id === agency.id)) throw new Error("Agency already exists.");
        return commit([...current.current.agencies, agency], current.current.transactions, makeAuditEvent("agency", "create", null, agency));
    };
    const requireAgency = (agencyId: string) => {
        const agency = current.current.agencies.find(item => item.id === agencyId);
        if (!agency) throw new Error("Agency no longer exists.");
        return agency;
    };
    const deactivateAgency = (agencyId: string) => {
        const before = requireAgency(agencyId), after = { ...before, active: false };
        return commit(current.current.agencies.map(item => item.id === agencyId ? after : item), current.current.transactions, makeAuditEvent("agency", "deactivate", before, after));
    };
    const deleteAgency = (agencyId: string) => {
        const before = requireAgency(agencyId);
        if (before.archivedAt) throw new Error("This agency is already archived.");
        const after = { ...before, active: false, archivedAt: new Date().toISOString() };
        return commit(current.current.agencies.map(item => item.id === agencyId ? after : item), current.current.transactions, makeAuditEvent("agency", "archive", before, after));
    };
    const restoreAgency = (agencyId: string) => {
        const before = requireAgency(agencyId);
        if (!before.archivedAt) throw new Error("This agency is already active.");
        const { archivedAt: _archivedAt, ...restored } = before;
        return commit(current.current.agencies.map(item => item.id === agencyId ? { ...restored, active: true } : item), current.current.transactions, makeAuditEvent("agency", "restore", before, { ...restored, active: true }));
    };
    const updateAgency = (agency: Agency, original?: Agency) => {
        const before = requireAgency(agency.id);
        if (original) agency = mergeAgencyEdit(before, original, agency);
        validateAgency(agency);
        if (sameRecord(before, agency)) return;
        return commit(current.current.agencies.map(item => item.id === agency.id ? agency : item), current.current.transactions, makeAuditEvent("agency", "edit", before, agency));
    };
    const requireTransaction = (transactionId: string) => {
        const tx = current.current.transactions.find(item => item.id === transactionId);
        if (!tx) throw new Error("This entry no longer exists.");
        return tx;
    };
    const deleteTransaction = (transactionId: string) => {
        const before = requireTransaction(transactionId);
        if (before.migration) throw Error("Linked migration records cannot be archived individually.");
        const after = changeArchive(before, true);
        return commit(current.current.agencies, current.current.transactions.map(item => item.id === transactionId ? after : item), makeAuditEvent("transaction", "archive", before, after));
    };
    const updateTransaction = (transaction: Transaction) => {
        const before = requireTransaction(transaction.id);
        if (before.archivedAt) throw new Error("Restore this entry before editing it.");
        protectTransaction(current.current, before, transaction);
        validateEntry(transaction, current.current.agencies, current.current.transactions, true);
        const after: Transaction = { ...transaction, voucher: transaction.voucher.trim(), status: "pending" };
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        return commit(current.current.agencies, current.current.transactions.map(item => item.id === after.id ? after : item), makeAuditEvent("transaction", "edit", before, after));
    };
    const setArchived = (transactionId: string, archived: boolean) => {
        const before = requireTransaction(transactionId);
        if (before.migration) throw Error("Linked migration records cannot be archived individually.");
        const after = changeArchive(before, archived);
        return commit(current.current.agencies, current.current.transactions.map(item => item.id === transactionId ? after : item), makeAuditEvent("transaction", archived ? "archive" : "restore", before, after));
    };
    const reverse = (transactionId: string, date: string, reason: string) => {
        const before=requireTransaction(transactionId);
        const after=makeReversal(current.current,before,date,reason,crypto.randomUUID(),new Date().toISOString());
        return commit(current.current.agencies,[...current.current.transactions,after],makeAuditEvent("transaction","reverse",null,after));
    };
    const reconcile = (transactionId: string, match: Transaction["reconciliation"] | null) => {
        const before=requireTransaction(transactionId), after={...before};
        if(match){validateMatch(current.current,before,match);after.reconciliation=match;}else delete after.reconciliation;
        return commit(current.current.agencies,current.current.transactions.map(t=>t.id===transactionId?after:t),makeAuditEvent("transaction",match?"reconcile":"unreconcile",before,after));
    };
    const restoreBackup = async (input: LedgerSnapshot<Agency,Transaction>, expected: string) => {
        const data=validateBackup(input);
        const view={version:2 as const,agencies:current.current.agencies,transactions:current.current.transactions,activity:current.current.activity};
        if(JSON.stringify(view)!==expected)throw Error("Ledger changed after preview. Preview the backup again.");
        if(current.current.agencies.some(a=>a.closedThrough))throw Error("Restore cannot overwrite closed periods. Use an empty ledger.");
        if(cloud){const next=await cloud.restore(data,current.current.revision || 0);current.current=next;setSnapshot(next);return;}
        localStorage.setItem("aegis-pre-restore-backup",JSON.stringify(current.current));
        const event=makeAuditEvent("ledger","restore",null,{id:crypto.randomUUID(),name:"JSON backup restored",agencies:data.agencies.length,transactions:data.transactions.length});
        const next={...data,activity:[...current.current.activity,...data.activity.map((e,i)=>({...e,id:`restored-${event.id}-${i}`,actor:"Restored backup history (unverified)"})),event]};
        disk.current=persistLedger(localStorage,disk.current,next);current.current=next;setSnapshot(next);
    };
    useEffect(() => {
        if (cloud) return;
        // Replace the auxiliary queue so edited/deleted records cannot remain as stale copies.
        let cancelled = false;
        void offlineDb().then(db => {
            if (cancelled) { db.close(); return; }
            const batch = db.transaction("pending-transactions", "readwrite");
            const queue = batch.objectStore("pending-transactions");
            queue.clear();
            transactions.filter(t => t.status === "pending" || t.status === "failed").forEach(t => queue.put(t));
            batch.oncomplete = () => db.close();
            batch.onerror = () => { console.warn("Offline queue update failed", batch.error); db.close(); };
        }).catch(error => console.warn("Offline queue unavailable", error));
        return () => { cancelled = true; };
    }, [transactions, Boolean(cloud)]);

    return { agencies, transactions, activity, migrate, reverse, reconcile, restoreBackup, add, addAgency, deactivateAgency, deleteAgency, restoreAgency, updateAgency, deleteTransaction, updateTransaction, setArchived };
}

const navItems: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "agencies", label: "Agencies", icon: Building2 },
    { id: "sales", label: "Ticket Sales", icon: Ticket },
    { id: "payments", label: "Payment Receipts", icon: Receipt },
    { id: "ledger", label: "Agency Ledger", icon: BookOpen },
    { id: "reports", label: "Reports", icon: FileBarChart },
    { id: "personal", label: "Personal", icon: Wallet },
    { id: "reconciliation", label: "Reconciliation", icon: Landmark },
    { id: "archive", label: "Archive", icon: Archive },
    { id: "activity", label: "Activity Log", icon: Activity },
    { id: "settings", label: "Settings", icon: SettingsIcon },
    { id: "install", label: "Install Tutorial", icon: Download },
];

type ToastKind = "success" | "error";
type Toast = { id: number; kind: ToastKind; message: string };
const ToastContext = createContext<(kind: ToastKind, message: string) => void>(() => {});

export default function App() {
    const store = useLedgerStore();
    const cloud = useCloudLedger();
    const [page, setPage] = useState<Page>("dashboard");
    const [form, setForm] = useState<FormMode>(null);
    const [refundSource, setRefundSource] = useState<Transaction | null>(null);
    const [migrationSource, setMigrationSource] = useState<Transaction | null>(null);
    const [migrationInfo, setMigrationInfo] = useState<Transaction["migration"] | null>(null);
    const [selectedAgency, setSelectedAgency] = useState("agency-1");
    const [lastCredit, setLastCredit] = useState<Transaction | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [online, setOnline] = useState(navigator.onLine);
    const syncing = false;
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [editingAgency, setEditingAgency] = useState<Agency | null>(null);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{
        type: "agency" | "transaction";
        id: string;
        label: string;
    } | null>(null);
    const visible = activeLedgerRecords(store.agencies, store.transactions);
    const pending = store.transactions.filter(
        (t) => t.status === "pending" || t.status === "failed",
    ).length;
    useEffect(() => {
        const on = () => setOnline(true);
        const off = () => setOnline(false);
        window.addEventListener("online", on);
        window.addEventListener("offline", off);
        return () => {
            window.removeEventListener("online", on);
            window.removeEventListener("offline", off);
        };
    }, []);
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") closeMobileNav();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);
    const sync = () => {
        if (cloud) { void cloud.refresh().catch(() => undefined); return; }
    };
    const closeMobileNav = () => setMobileNavOpen(false);
    const toggleMobileNav = () => setMobileNavOpen((open) => !open);
    const go = (next: Page) => {
        if (!window.dispatchEvent(new Event("ledger:navigate", {cancelable:true}))) return;
        setForm(null);setEditingAgency(null);setEditingTransaction(null);
        setPage(next);
        closeMobileNav();
        window.scrollTo({ top: 0, behavior: "smooth" });
    };
    const pushToast = (kind: ToastKind, message: string) => {
        const id = Date.now() + Math.random();
        setToasts((current) => [...current, { id, kind, message }]);
        window.setTimeout(() => {
            setToasts((current) => current.filter((toast) => toast.id !== id));
        }, 3200);
    };
    const confirmDelete = (type: "agency" | "transaction", id: string, label: string) => {
        setDeleteTarget({ type, id, label });
    };
    const applyDelete = async () => {
        if (!deleteTarget) return;
        try {
            if (deleteTarget.type === "agency") {
                await store.deleteAgency(deleteTarget.id);
            } else {
                await store.deleteTransaction(deleteTarget.id);
            }
            setDeleteTarget(null);
            pushToast("success", deleteTarget.type === "agency" ? "Agency archived successfully." : "Entry archived successfully.");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to delete record.";
            pushToast("error", message);
        }
    };
    const archiveTransaction = async (transactionId: string, archived = true) => {
        try { await store.setArchived(transactionId, archived); setLastCredit(null); pushToast("success", archived ? "Entry archived successfully." : "Entry restored successfully."); }
        catch (error) { const message = error instanceof Error ? error.message : "Unable to update archive."; pushToast("error", message); }
    };
    const openEditAgency = (agency: Agency) => {
        setEditingAgency({ ...agency });
        setForm("agency");
    };
    const openEditTransaction = (transaction: Transaction) => {
        if (isTaxRefund(transaction)) {
            setRefundSource(transaction);
            return;
        }
        setEditingTransaction(transaction);
        setForm(transaction.type === "sale" ? "sale" : "payment");
    };
    const title = navItems.find((n) => n.id === page)?.label || "Dashboard";
    return (
        <ToastContext.Provider value={pushToast}>
        <MigrationContext.Provider value={{start:setMigrationSource,refund:t=>setRefundSource(store.transactions.find(record=>record.id===t.id) || t),details:setMigrationInfo,transactions:store.transactions}}>
            {refundSource && <TaxRefundForm source={refundSource} onClose={()=>setRefundSource(null)} onSave={async refund=>{
                const current = store.transactions.find(t=>t.id===refundSource.id);
                if (!sameRecord(current, refundSource)) throw Error("This entry changed. Close and reopen the refund form.");
                if (isTaxRefund(refundSource)) await store.updateTransaction(refund);
                else await store.add(refund);
            }} />}
            {migrationSource && <MigrationForm source={migrationSource} agencies={store.agencies} onClose={()=>setMigrationSource(null)} onSave={store.migrate} />}
            {migrationInfo && <MigrationDetails migration={migrationInfo} agencies={store.agencies} transactions={store.transactions} onClose={()=>setMigrationInfo(null)} />}
        <div className={`app-shell${mobileNavOpen ? " show-mobile-nav" : ""}`}>
            <button
                type="button"
                className={`mobile-nav-backdrop${mobileNavOpen ? " visible" : ""}`}
                aria-label="Close navigation"
                onClick={closeMobileNav}
            />
            <aside className="sidebar">
                <div className="brand">
                    <img
                        className="brand-logo"
                        src="/az-air-travels-logo.png"
                        alt="A TO Z AIR TRAVELS logo"
                        onError={(event) => {
                            event.currentTarget.style.display = "none";
                            const fallback = event.currentTarget.nextElementSibling;
                            if (fallback instanceof HTMLElement) {
                                fallback.style.display = "grid";
                            }
                        }}
                    />
                    <div className="brand-fallback" aria-hidden="true">A2Z</div>
                    <div>
                        <strong>A TO Z</strong>
                        <span>AIR TRAVELS</span>
                    </div>
                    <button
                        type="button"
                        className="sidebar-close"
                        aria-label="Close menu"
                        onClick={closeMobileNav}
                    >
                        <X size={18} />
                    </button>
                </div>
                <div className="workspace-label">
                    WORKSPACE <span className="demo-tag">DEMO</span>
                </div>
                <nav>
                    {navItems.map((item) => (
                        <button
                            key={item.id}
                            className={page === item.id ? "nav-item active" : "nav-item"}
                            onClick={() => go(item.id)}
                        >
                            <item.icon size={18} />
                            <span>{item.label}</span>
                            {item.id === "ledger" && pending > 0 && (
                                <b className="nav-count">{pending}</b>
                            )}
                        </button>
                    ))}
                </nav>
                <div className="sidebar-bottom">
                    <div className="sync-card">
                        <div className="sync-icon">
                            <ShieldCheck size={17} />
                        </div>
                        <div>
                            <b>{cloud ? "Cloud ledger" : "Local data"}</b>
                            <span>{cloud ? "Firebase / Firestore" : "Stored in this browser"}</span>
                        </div>
                        <Check size={16} className="check" />
                    </div>
                    <div className="profile">
                        <div className="avatar">AR</div>
                        <div>
                            <b>Your account</b>
                            <span>Business owner</span>
                        </div>
                        <MoreHorizontal size={17} />
                    </div>
                </div>
            </aside>
            <main className="main-content">
                <header className="topbar">
                    <button
                        className="mobile-menu"
                        aria-label="Toggle navigation"
                        aria-expanded={mobileNavOpen}
                        onClick={toggleMobileNav}
                    >
                        <Menu size={21} />
                    </button>
                    <div>
                        <div className="breadcrumb">
                            WORKSPACE <ChevronRight size={13} /> {title}
                        </div>
                        <h1>{title}</h1>
                    </div>
                    <div className="top-actions">
                        <div className={online ? "connection online" : "connection offline"}>
                            {online ? <Cloud size={16} /> : <CloudOff size={16} />}
                            <span>{online ? "Online" : "Offline"}</span>
                        </div>
                        {pending > 0 && !cloud && (
                            <button className="sync-button" onClick={sync}>
                                <RefreshCw size={15} className={syncing ? "spin" : ""} />{" "}
                                {cloud ? "Refresh cloud" : syncing ? "Syncing" : `${pending} pending sync`}
                            </button>
                        )}
                        <button className="icon-button">
                            <Bell size={18} />
                            <i />
                        </button>
                        <AccountMenu busy={cloud?.busy} />
                    </div>
                </header>
                {!online && (
                    <div className="offline-banner">
                        <CloudOff size={17} />
                        <span>{cloud ? "You are offline. Reconnect before saving financial changes." : "You are offline. New entries are saved in this browser. Server sync is not configured."}</span>
                        <button onClick={sync}>Try again</button>
                    </div>
                )}
                <div className="page-body">
                    <div hidden={page !== "install"}><InstallGuide /></div>
                    {lastCredit && (
                        <CreditReceiptNotice
                            transaction={lastCredit}
                            agency={store.agencies.find((item) => item.id === lastCredit.agencyId) || store.agencies[0]}
                            onDownload={() => {
                                const agency = store.agencies.find((item) => item.id === lastCredit.agencyId) || store.agencies[0];
                                downloadCreditReceiptPdf(agency, { date: lastCredit.date, voucher: lastCredit.voucher, amount: String(lastCredit.amount / 100), method: lastCredit.method || "Bank Transfer", reference: lastCredit.reference || "", bank: lastCredit.bank || "", sendingBank: lastCredit.sendingBank, receivingBank: lastCredit.receivingBank, sendingBankName: lastCredit.sendingBankName, receivingBankName: lastCredit.receivingBankName, narration: lastCredit.narration || "" });
                            }}
                            onDismiss={() => setLastCredit(null)}
                        />
                    )}
                    {page === "dashboard" && (
                        <Dashboard
                            agencies={visible.agencies}
                            transactions={visible.transactions}
                            onNavigate={go}
                        />
                    )}{" "}
                    {page === "agencies" && (
                        <Agencies
                            agencies={visible.agencies}
                            transactions={visible.transactions}
                            onAdd={() => {
                                setEditingAgency(null);
                                setForm("agency");
                            }}
                            onEdit={openEditAgency}
                            onDelete={(id) => {
                                const agency = store.agencies.find((item) => item.id === id);
                                confirmDelete("agency", id, agency?.name || "agency");
                            }}
                            onDeactivate={async id => { try { await store.deactivateAgency(id); } catch (error) { console.error(error instanceof Error ? error.message : "Unable to deactivate agency."); } }}
                            onSelect={(id) => {
                                setSelectedAgency(id);
                                go("ledger");
                            }}
                        />
                    )}{" "}
                    {page === "sales" && (
                        <SalesPage
                            agencies={visible.agencies}
                            transactions={visible.transactions}
                            onAdd={store.add}
                            online={online}
                            onArchive={archiveTransaction}
                            onEdit={openEditTransaction}
                            onDelete={(id) => {
                                const tx = store.transactions.find((item) => item.id === id);
                                confirmDelete("transaction", id, tx?.voucher || "this entry");
                            }}
                        />
                    )}{" "}
                    {page === "payments" && (
                        <PaymentPage
                            agencies={visible.agencies}
                            transactions={visible.transactions}
                            onAdd={store.add}
                            online={online}
                            onArchive={archiveTransaction}
                            onEdit={openEditTransaction}
                            onDelete={(id) => {
                                const tx = store.transactions.find((item) => item.id === id);
                                confirmDelete("transaction", id, tx?.voucher || "this entry");
                            }}
                        />
                    )}{" "}
                    {page === "ledger" && (
                        <LedgerPage
                            agencies={visible.agencies}
                            transactions={visible.transactions}
                            selected={selectedAgency}
                            setSelected={setSelectedAgency}
                            onAddSale={() => setForm("sale")}
                            onAddCredit={() => setForm("payment")}
                            onEdit={openEditTransaction}
                            onDelete={(id) => {
                                const tx = store.transactions.find((item) => item.id === id);
                                confirmDelete("transaction", id, tx?.voucher || "this entry");
                            }}
                        />
                    )}{" "}
                    {page === "reports" && (
                        <Reports
                            agencies={visible.agencies}
                            transactions={visible.transactions}
                            onEdit={openEditTransaction}
                            onDelete={(id) => {
                                const tx = store.transactions.find((item) => item.id === id);
                                confirmDelete("transaction", id, tx?.voucher || "this entry");
                            }}
                        />
                    )}{" "}
                    {page === "archive" && (
                        <ArchivePage
                            agencies={store.agencies}
                            transactions={store.transactions}
                            onRestoreAgency={async (agencyId) => {
                                try {
                                    await store.restoreAgency(agencyId);
                                    pushToast("success", "Agency restored successfully.");
                                } catch (error) {
                                    pushToast("error", error instanceof Error ? error.message : "Unable to restore agency.");
                                }
                            }}
                            onRestoreTransaction={(id) => archiveTransaction(id, false)}
                        />
                    )}
                    {page === "personal" && <PersonalLedger />}
                    {page === "activity" && <ActivityLog events={store.activity} agencies={store.agencies} />}
                    {page === "reconciliation" && <LedgerTools initialTab="match" snapshot={{version:2,agencies:store.agencies,transactions:store.transactions,activity:store.activity}} onRestore={store.restoreBackup} onAgency={store.updateAgency} onReverse={store.reverse} onMatch={store.reconcile} />}
                    {page === "settings" && <><LedgerTools snapshot={{version:2,agencies:store.agencies,transactions:store.transactions,activity:store.activity}} onRestore={store.restoreBackup} onAgency={store.updateAgency} onReverse={store.reverse} onMatch={store.reconcile} /><Settings pending={pending} snapshot={{ version: 2, agencies: store.agencies, transactions: store.transactions, activity: store.activity }} /></>}
                </div>
            </main>
            {form === "agency" && (
                <AgencyModal
                    initialData={editingAgency || undefined}
                    onClose={() => {
                        setEditingAgency(null);
                        setForm(null);
                    }}
                    onSave={async (agency) => {

                        if (editingAgency) {
                            await store.updateAgency({ ...agency, id: editingAgency.id }, editingAgency);
                        } else {
                            await store.addAgency(agency);
                        }
                    }}
                />
            )}{" "}
            {form === "sale" && (
                <SaleForm
                    agencies={store.agencies}
                    initialAgencyId={selectedAgency}
                    initialTransaction={editingTransaction && editingTransaction.type === "sale" ? editingTransaction : undefined}
                    onClose={() => {
                        setEditingTransaction(null);
                        setForm(null);
                    }}
                    onSave={async (sale) => {
                        if (editingTransaction && !sameRecord(store.transactions.find(t => t.id === editingTransaction.id), editingTransaction)) throw new Error("This entry changed while you were editing. Close and reopen the form.");
                        if (editingTransaction && editingTransaction.type === "sale") {
                            await store.updateTransaction({ ...sale, id: editingTransaction.id });
                        } else {
                            await store.add(sale);
                        }
                    }}
                    online={online}
                />
            )}
            {form === "payment" && (
                <PaymentForm
                    agencies={store.agencies}
                    initialAgencyId={selectedAgency}
                    initialTransaction={editingTransaction && editingTransaction.type === "payment" ? editingTransaction : undefined}
                    onClose={() => {
                        setEditingTransaction(null);
                        setForm(null);
                    }}
                    onSave={async (payment) => {
                        if (editingTransaction && !sameRecord(store.transactions.find(t => t.id === editingTransaction.id), editingTransaction)) throw new Error("This entry changed while you were editing. Close and reopen the form.");
                        if (editingTransaction && editingTransaction.type === "payment") {
                            await store.updateTransaction({ ...payment, id: editingTransaction.id });
                        } else {
                            await store.add(payment);
                            setLastCredit(payment);
                        }
                    }}
                    online={online}
                />
            )}
            {deleteTarget && (
                <DeleteConfirmModal
                    title={deleteTarget.type === "agency" ? "Archive agency" : "Archive entry"}
                    label={deleteTarget.label}
                    onClose={() => setDeleteTarget(null)}
                    onConfirm={applyDelete}
                />
            )}
            <ToastStack toasts={toasts} />
            <MobileNav page={page} go={go} closeMobileNav={closeMobileNav} />
        </div>
        </MigrationContext.Provider>
        </ToastContext.Provider>
    );
}

function ToastStack({ toasts }: { toasts: Toast[] }) {
    return (
        <div className="toast-stack" aria-live="polite" aria-atomic="true">
            {toasts.map((toast) => (
                <div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
                    {toast.message}
                </div>
            ))}
        </div>
    );
}

function CreditReceiptNotice({ transaction, agency, onDownload, onDismiss }: { transaction: Transaction; agency: Agency; onDownload: () => void; onDismiss: () => void }) {
    return <div className="credit-receipt-notice"><div className="receipt-notice-icon"><Receipt size={19} /></div><div className="receipt-notice-copy"><strong>Credit saved successfully</strong><span>{agency.name} · Receipt {transaction.voucher} · BDT {(transaction.amount / 100).toLocaleString("en-BD", { minimumFractionDigits: 2 })}</span></div><button className="receipt-download-button" onClick={onDownload}><Download size={15} /> Download Money Receipt PDF</button><button className="receipt-dismiss" onClick={onDismiss} aria-label="Dismiss receipt notice"><X size={16} /></button></div>;
}

function Dashboard({
    agencies,
    transactions,
    onNavigate,
}: {
    agencies: Agency[];
    transactions: Transaction[];
    onNavigate: (p: Page) => void;
}) {
    const profit = profitSummary(transactions);
    const sales = transactions
        .filter((t) => t.type === "sale")
        .reduce((s, t) => s + t.amount, 0),
        payments = transactions
            .filter((t) => t.type === "payment")
            .reduce((s, t) => s + t.amount, 0);
    const balances = agencies.map((a) => ({
        agency: a,
        balance: getBalance(a, transactions),
    })),
        receivables = balances
            .filter((x) => x.balance > 0)
            .reduce((s, x) => s + x.balance, 0),
        advances = balances
            .filter((x) => x.balance < 0)
            .reduce((s, x) => s + Math.abs(x.balance), 0);
    return (
        <>
            <div className="welcome-row">
                <div>
                    <p className="eyebrow">All recorded transactions</p>
                    <p className="subtle">A clear view of your business finances.</p>
                </div>
                <div className="date-filter">
                    <CalendarDays size={16} /> <span>All dates</span>
                    <ChevronRight size={15} />
                </div>
            </div>
            <div className="stat-grid">
                <Stat
                    icon={Building2}
                    label="Total agencies"
                    value={String(agencies.filter((a) => a.active).length)}
                    meta={`${agencies.length} registered`}
                    tone="blue"
                />
                <Stat
                    icon={ArrowUpRight}
                    label="Ticket Sales"
                    value={money(sales)}
                    meta="All dates"
                    tone="teal"
                />
                <Stat
                    icon={ArrowDownLeft}
                    label="Payments received"
                    value={money(payments)}
                    meta="All dates"
                    tone="orange"
                />
                <Stat
                    icon={CircleDollarSign}
                    label="Total receivables"
                    value={money(receivables)}
                    meta="From agencies"
                    tone="ink"
                />
                <Stat icon={TrendingUp} label="Total profit" value={`${profit.total < 0 ? "-" : ""}${money(profit.total)}`} meta={profit.missingCosts ? `Partial total: ${profit.missingCosts} entries missing cost` : "All dates"} tone="teal" />
            </div>
            <div className="dashboard-grid">
                <section className="panel balance-panel">
                    <div className="panel-heading">
                        <div>
                            <h2>Balance overview</h2>
                            <p>Current position across all agencies</p>
                        </div>
                        <button
                            className="text-button"
                            onClick={() => onNavigate("ledger")}
                        >
                            View ledger <ChevronRight size={15} />
                        </button>
                    </div>
                    <div className="balance-highlight">
                        <div>
                            <span className="label">Total receivables</span>
                            <strong>{money(receivables)}</strong>
                            <small>
                                <TrendingUp size={13} /> Outstanding from agencies
                            </small>
                        </div>
                        <div>
                            <span className="label">Total advances</span>
                            <strong className="orange-text">{money(advances)}</strong>
                            <small>
                                <TrendingDown size={13} /> Agency credit
                            </small>
                        </div>
                    </div>
                    <div className="mini-bars">
                        {balances.slice(0, 4).map(({ agency, balance }) => (
                            <div className="bar-row" key={agency.id}>
                                <div className="bar-label">
                                    <span>{agency.name}</span>
                                    <b className={balance < 0 ? "orange-text" : ""}>
                                        {money(balanceMeta(balance).value)}{" "}
                                        {balanceMeta(balance).side}
                                    </b>
                                </div>
                                <div className="bar-track">
                                    <i
                                        style={{
                                            width: `${Math.min(100, Math.max(7, (Math.abs(balance) / Math.max(receivables, 1)) * 100))}%`,
                                            background: balance < 0 ? "#ef9d55" : "#218c8a",
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
                <section className="panel recent-panel">
                    <div className="panel-heading">
                        <div>
                            <h2>Recent activity</h2>
                            <p>Latest transactions</p>
                        </div>
                        <button className="icon-button">
                            <MoreHorizontal size={18} />
                        </button>
                    </div>
                    <div className="activity-list">
                        {transactions
                            .slice()
                            .sort(compareLedgerEntries)
                            .slice(-4)
                            .map((t) => (
                                <ActivityRow
                                    key={t.id}
                                    tx={t}
                                    agency={agencies.find((a) => a.id === t.agencyId)!}
                                />
                            ))}
                    </div>
                    <button className="full-link" onClick={() => onNavigate("reports")}>
                        View all transactions <ChevronRight size={15} />
                    </button>
                </section>
            </div>
            <section className="panel table-panel">
                <div className="panel-heading">
                    <div>
                        <h2>Largest outstanding agencies</h2>
                        <p>By current balance</p>
                    </div>
                    <button
                        className="text-button"
                        onClick={() => onNavigate("agencies")}
                    >
                        All agencies <ChevronRight size={15} />
                    </button>
                </div>
                <AgencyBalanceTable
                    rows={balances
                        .filter((x) => x.balance >= 0)
                        .sort((a, b) => b.balance - a.balance)
                        .slice(0, 3)}
                />
            </section>
        </>
    );
}
function Stat({
    icon: Icon,
    label,
    value,
    meta,
    tone,
}: {
    icon: typeof Building2;
    label: string;
    value: string;
    meta: string;
    tone: string;
}) {
    return (
        <div className="stat-card">
            <div className={`stat-icon ${tone}`}>
                <Icon size={18} />
            </div>
            <div>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{meta}</small>
            </div>
            <MoreHorizontal size={17} className="more" />
        </div>
    );
}
function ActivityRow({ tx, agency }: { tx: Transaction; agency: Agency }) {
    return (
        <div className="activity-row">
            <div className={`activity-icon ${tx.type}`}>
                {tx.type === "sale" ? <Ticket size={16} /> : <Wallet size={16} />}
            </div>
            <div className="activity-info">
                <b>{tx.type === "sale" ? "Ticket Sales" : "Payments received"}</b>
                <span>
                    {agency.name} · {tx.voucher}
                </span>
            </div>
            <MigrationTag transaction={tx} />
            <div className="activity-amount">
                <b className={tx.type === "sale" ? "debit" : "credit"}>
                    {tx.type === "sale" ? "+" : "-"}
                    {money(tx.amount)}
                </b>
                <small>{tx.date}</small>
            </div>
        </div>
    );
}
function AgencyContactButtons({ agency }: { agency: Agency }) {
    const links = agencyContactLinks(agency.phone || "");
    return <span className="agency-contact-buttons">
        {links ? <>
            <a className="outline-button" href={links.call} aria-label={`Call ${agency.name}`}><Phone size={14} /> Call</a>
            <a className="outline-button" href={links.whatsapp} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${agency.name}`}><MessageCircle size={14} /> WhatsApp</a>
        </> : <>
            <button className="outline-button" disabled title="Add a valid phone number in Edit agency"><Phone size={14} /> Call</button>
            <button className="outline-button" disabled title="Add a valid phone number in Edit agency"><MessageCircle size={14} /> WhatsApp</button>
        </>}
    </span>;
}

function AgencyBalanceTable({
    rows,
}: {
    rows: { agency: Agency; balance: number }[];
}) {
    return (
        <div className="simple-table">
            <div className="table-row table-head">
                <span>Agency</span>
                <span>Code</span>
                <span>Contact</span>
                <span>Balance</span>
            </div>
            {rows.map(({ agency, balance }) => (
                <div className="table-row" key={agency.id}>
                    <span className="agency-cell">
                        <span className="agency-avatar">{agency.name.slice(0, 1)}</span>
                        <b>{agency.name}</b>
                    </span>
                    <span className="muted-code">{agency.code}</span>
                    <span className="muted-code">{agency.contact}<AgencyContactButtons agency={agency} /></span>
                    <span className="balance-cell">
                        <b>{money(Math.abs(balance))}</b>
                        <em>{balanceMeta(balance).side}</em>
                    </span>
                </div>
            ))}
        </div>
    );
}

function Agencies({
    agencies,
    transactions,
    onAdd,
    onSelect,
    onEdit,
    onDelete,
    onDeactivate,
}: {
    agencies: Agency[];
    transactions: Transaction[];
    onAdd: () => void;
    onSelect: (id: string) => void;
    onEdit: (agency: Agency) => void;
    onDelete: (id: string) => void;
    onDeactivate: (id: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const pageSize = 12;
    const filtered = agencies.filter((agency) => !agency.archivedAt).filter((agency) =>
        `${agency.name} ${agency.code} ${agency.contact} ${agency.phone} ${agency.address}`
            .toLowerCase()
            .includes(query.toLowerCase()),
    );
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const shown = filtered.slice((page - 1) * pageSize, page * pageSize);
    useEffect(() => setPage(1), [query]);
    useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
    return (
        <>
            <div className="section-toolbar">
                <div className="search-box">
                    <Search size={17} />
                    <input
                        placeholder="Search agency, code, contact, phone or address"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </div>
                <div className="toolbar-actions">
                    <button className="outline-button" onClick={() => downloadAgencyDirectoryPdf(filtered, transactions)}>
                        <Download size={15} /> Download PDF
                    </button>
                    <button className="primary-button" onClick={onAdd}>
                        <Plus size={17} /> New Agency
                    </button>
                </div>
            </div>
            <section className="panel agency-list-panel">
                <div className="panel-heading">
                    <div>
                        <h2>Agency Directory</h2>
                        <p>{filtered.length} agencies found · Showing {shown.length}</p>
                    </div>
                </div>
                <div className="agency-grid">
                    {shown.map((agency) => {
                        const balance = getBalance(agency, transactions);
                        const agencyProfit = profitSummary(transactions.filter(t=>t.agencyId===agency.id),transactions);
                        return (
                            <div className={`agency-card ${!agency.active ? "inactive" : ""}`} key={agency.id}>
                                <div className="agency-card-top">
                                    <span className="agency-avatar large">{agency.name.slice(0, 1)}</span>
                                    <div><h3>{agency.name}</h3><span className="code-pill">{agency.code}</span></div>
                                    <button className="icon-button" title="Deactivate agency" onClick={() => agency.active && onDeactivate(agency.id)}><MoreHorizontal size={18} /></button>
                                </div>
                                <div className="agency-detail"><span><Users size={14} /> {agency.contact}</span><span><Activity size={14} /> {agency.phone}</span></div>
                                <div className="agency-detail"><span>Total profit / loss</span><b>{agencyProfit.total<0?"-":""}{money(agencyProfit.total)}</b>{agencyProfit.missingCosts>0&&<small>Partial: {agencyProfit.missingCosts} missing costs</small>}</div>
                                <div className="agency-card-bottom"><div><small>Current balance</small><b className={balance < 0 ? "orange-text" : ""}>{money(balanceMeta(balance).value)} <em>{balanceMeta(balance).side}</em></b></div><div className="agency-actions"><AgencyContactButtons agency={agency} /><button className="outline-button" onClick={() => onSelect(agency.id)}>View Ledger <ChevronRight size={14} /></button><button className="outline-button" onClick={() => onEdit(agency)}>Edit</button><button className="danger-button" onClick={() => onDelete(agency.id)}>Archive</button></div></div>
                                {!agency.active && <span className="inactive-badge">Inactive</span>}
                            </div>
                        );
                    })}
                </div>
                <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
            </section>
        </>
    );
}

function SalesPage({ agencies, transactions, onAdd, online, onEdit, onDelete, onArchive }: { agencies: Agency[]; transactions: Transaction[]; onAdd: (t: Transaction) => void | Promise<void>; online: boolean; onEdit?: (transaction: Transaction) => void; onDelete?: (id: string) => void; onArchive?: (id: string) => void; }) {
    const [show, setShow] = useState(false);
    const [query, setQuery] = useState({ agency: "", from: "", to: "", passenger: "", ticket: "", voucher: "", reference: "", phone: "" });
    const [page, setPage] = useState(1);
    const pageSize = 25;
    const update = (key: keyof typeof query, value: string) => setQuery((current) => ({ ...current, [key]: value }));
    const sales = transactions.filter((transaction) => {
        if (transaction.type !== "sale") return false;
        const agency = agencies.find((item) => item.id === transaction.agencyId);
        return (!query.agency || agency?.id === query.agency) && (!query.from || transaction.date >= query.from) && (!query.to || transaction.date <= query.to) && (!query.passenger || (transaction.passenger || "").toLowerCase().includes(query.passenger.toLowerCase())) && (!query.ticket || (transaction.ticket || "").toLowerCase().includes(query.ticket.toLowerCase())) && (!query.voucher || transaction.voucher.toLowerCase().includes(query.voucher.toLowerCase())) && (!query.reference || (transaction.reference || "").toLowerCase().includes(query.reference.toLowerCase())) && (!query.phone || (agency?.phone || "").includes(query.phone));
    });
    const pageCount = Math.max(1, Math.ceil(sales.length / pageSize));
    const shownSales = sales.slice((page - 1) * pageSize, page * pageSize);
    useEffect(() => setPage(1), [query]);
    useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
    return <>
        <div className="page-intro"><p>Search every ticket by agency, date, passenger, phone, ticket, voucher or reference.</p><button className="primary-button" onClick={() => setShow(true)}><Plus size={17} /> Add Ticket Sale</button></div>
        {show && <SaleForm agencies={agencies} onClose={() => setShow(false)} onSave={async (sale) => { await onAdd(sale); setShow(false); }} online={online} />}
        <section className="panel filter-panel"><div className="filter-grid"><select value={query.agency} onChange={(event) => update("agency", event.target.value)}><option value="">All agencies</option>{agencies.map((agency) => <option key={agency.id} value={agency.id}>{agency.name}</option>)}</select><input type="date" value={query.from} onChange={(event) => update("from", event.target.value)} /><input type="date" value={query.to} onChange={(event) => update("to", event.target.value)} /><input placeholder="Passenger name" value={query.passenger} onChange={(event) => update("passenger", event.target.value)} /><input placeholder="Mobile number" value={query.phone} onChange={(event) => update("phone", event.target.value)} /><input placeholder="Ticket number" value={query.ticket} onChange={(event) => update("ticket", event.target.value)} /><input placeholder="Voucher number" value={query.voucher} onChange={(event) => update("voucher", event.target.value)} /><input placeholder="Reference number" value={query.reference} onChange={(event) => update("reference", event.target.value)} /></div></section>
        <section className="panel report-panel"><div className="panel-heading"><div><h2>Ticket Sales</h2><p>{sales.length} matching records</p></div><button className="filter-button" onClick={() => setQuery({ agency: "", from: "", to: "", passenger: "", ticket: "", voucher: "", reference: "", phone: "" })}><RefreshCw size={15} /> Clear filters</button></div><TransactionTable transactions={shownSales} agencies={agencies} onEdit={onEdit} onDelete={onDelete} onArchive={onArchive} /><Pagination page={page} pageCount={pageCount} onPageChange={setPage} /></section>
    </>;
}

function OriginalAgencies({
    agencies,
    transactions,
    onAdd,
    onSelect,
}: {
    agencies: Agency[];
    transactions: Transaction[];
    onAdd: () => void;
    onSelect: (id: string) => void;
}) {
    const [query, setQuery] = useState("");
    const shown = agencies.filter((a) =>
        `${a.name} ${a.code} ${a.contact}`
            .toLowerCase()
            .includes(query.toLowerCase()),
    );
    return (
        <>
            <div className="section-toolbar">
                <div className="search-box">
                    <Search size={17} />
                    <input
                        placeholder="Search agencies..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </div>
                <button className="primary-button" onClick={onAdd}>
                    <Plus size={17} /> New agency
                </button>
            </div>
            <div className="notice">
                <ShieldCheck size={17} />
                <div>
                    <b>Agency data is protected</b>
                    <span>
                        Deactivating an agency preserves historical transactions and reports.
                    </span>
                </div>
                <X size={16} />
            </div>
            <section className="panel agency-list-panel">
                <div className="panel-heading">
                    <div>
                        <h2>Agency list</h2>
                        <p>
                            {agencies.filter((a) => a.active).length} active ·{" "}
                            {agencies.length} total
                        </p>
                    </div>
                    <button className="filter-button">
                        <Filter size={16} /> Filter
                    </button>
                </div>
                <div className="agency-grid">
                    {shown.map((a) => {
                        const b = getBalance(a, transactions);
                        return (
                            <div
                                className={`agency-card ${!a.active ? "inactive" : ""}`}
                                key={a.id}
                            >
                                <div className="agency-card-top">
                                    <span className="agency-avatar large">
                                        {a.name.slice(0, 1)}
                                    </span>
                                    <div>
                                        <h3>{a.name}</h3>
                                        <span className="code-pill">{a.code}</span>
                                    </div>
                                    <button className="icon-button">
                                        <MoreHorizontal size={18} />
                                    </button>
                                </div>
                                <div className="agency-detail">
                                    <span>
                                        <Users size={14} /> {a.contact}
                                    </span>
                                    <span>
                                        <Activity size={14} /> {a.phone}
                                    </span>
                                </div>
                                <AgencyContactButtons agency={a} />
                                <div className="agency-card-bottom">
                                    <div>
                                        <small>Current balance</small>
                                        <b className={b < 0 ? "orange-text" : ""}>
                                            {money(balanceMeta(b).value)}{" "}
                                            <em>{balanceMeta(b).side}</em>
                                        </b>
                                    </div>
                                    <button
                                        className="outline-button"
                                        onClick={() => onSelect(a.id)}
                                    >
                                        View ledger <ChevronRight size={14} />
                                    </button>
                                </div>
                                {!a.active && (
                                    <span className="inactive-badge">Inactive</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>
        </>
    );
}

function OriginalSalesPage({
    agencies,
    transactions,
    onAdd,
    online,
}: {
    agencies: Agency[];
    transactions: Transaction[];
    onAdd: (t: Transaction) => void | Promise<void>;
    online: boolean;
}) {
    const [show, setShow] = useState(false);
    const [query, setQuery] = useState("");
    const sales = transactions.filter(
        (t) =>
            t.type === "sale" &&
            `${t.passenger} ${t.ticket} ${t.voucher}`
                .toLowerCase()
                .includes(query.toLowerCase()),
    );
    return (
        <>
            <div className="page-intro">
                <div>
                    <p>
                        Every ticket sale is posted as a debit to the selected agency ledger.
                    </p>
                </div>
                <button className="primary-button" onClick={() => setShow(true)}>
                    <Plus size={17} /> Add ticket sale
                </button>
            </div>
            {show && (
                <SaleForm
                    agencies={agencies}
                    onClose={() => setShow(false)}
                    onSave={async (t) => {
                        await onAdd(t);
                        setShow(false);
                    }}
                    online={online}
                />
            )}
            <section className="panel report-panel">
                <div className="panel-heading">
                    <div>
                        <h2>Ticket Sales</h2>
                        <p>{sales.length} records · All dates</p>
                    </div>
                    <div className="table-tools">
                        <div className="search-box compact">
                            <Search size={16} />
                            <input
                                placeholder="Ticket, passenger, or voucher"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                        </div>
                        <button className="filter-button">
                            <Download size={15} /> CSV
                        </button>
                    </div>
                </div>
                <TransactionTable transactions={sales} agencies={agencies} />
            </section>
        </>
    );
}
function PaymentPage({
    agencies,
    transactions,
    onAdd,
    online,
    onEdit,
    onDelete,
    onArchive,
}: {
    agencies: Agency[];
    transactions: Transaction[];
    onAdd: (t: Transaction) => void | Promise<void>;
    online: boolean;
    onEdit?: (transaction: Transaction) => void;
    onDelete?: (id: string) => void;
    onArchive?: (id: string) => void;
}) {
    const [show, setShow] = useState(false);
    const payments = transactions.filter((t) => t.type === "payment");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const pageSize = 25;
    const filtered = payments.filter((transaction) => `${transaction.voucher} ${transaction.reference || ""} ${transaction.method || ""}`.toLowerCase().includes(query.toLowerCase()));
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const shownPayments = filtered.slice((page - 1) * pageSize, page * pageSize);
    useEffect(() => setPage(1), [query]);
    useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
    return (
        <>
            <div className="page-intro">
                <div>
                    <p>
                        Record agency payments as credits. Overpayments appear as a Cr balance.
                    </p>
                </div>
                <button className="primary-button" onClick={() => setShow(true)}>
                    <Plus size={17} /> Add payment receipt
                </button>
            </div>
            {show && (
                <PaymentForm
                    agencies={agencies}
                    onClose={() => setShow(false)}
                    onSave={async (t) => {
                        await onAdd(t);
                        setShow(false);
                    }}
                    online={online}
                />
            )}
            <section className="panel report-panel">
                <div className="panel-heading">
                    <div>
                        <h2>Payment Receipts</h2>
                        <p>{filtered.length} matching records</p>
                    </div>
                    <div className="table-tools"><div className="search-box compact"><Search size={16} /><input placeholder="Voucher, reference, or method" value={query} onChange={(event) => setQuery(event.target.value)} /></div><button className="filter-button" onClick={() => {
                        const rows = [["Date", "Agency", "Voucher", "Method", "Credit"], ...filtered.map(t => [t.date, agencies.find(a => a.id === t.agencyId)?.name || "", t.voucher, t.method || "", (t.amount / 100).toFixed(2)])];
                        const url = URL.createObjectURL(new Blob([encodeCsv(rows)], { type: "text/csv;charset=utf-8" }));
                        const link = document.createElement("a"); link.href = url; link.download = "payment-receipts.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}><Download size={15} /> CSV</button></div>
                </div>
                <TransactionTable transactions={shownPayments} agencies={agencies} onEdit={onEdit} onDelete={onDelete} onArchive={onArchive} /><Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
            </section>
        </>
    );
}

function Pagination({ page, pageCount, onPageChange }: { page: number; pageCount: number; onPageChange: (page: number) => void }) {
    if (pageCount <= 1) return null;
    return <div className="pagination" aria-label="Pagination"><button className="outline-button" disabled={page === 1} onClick={() => onPageChange(page - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button className="outline-button" disabled={page === pageCount} onClick={() => onPageChange(page + 1)}>Next</button></div>;
}

function ArchivePage({
    agencies,
    transactions,
    onRestoreAgency,
    onRestoreTransaction,
}: {
    agencies: Agency[];
    transactions: Transaction[];
    onRestoreAgency: (agencyId: string) => void | Promise<void>;
    onRestoreTransaction: (id: string) => void;
}) {
    const archivedAgencies = agencies.filter((a) => a.archivedAt);
    const archivedAgencyIds = new Set(archivedAgencies.map(agency => agency.id));
    const archivedTransactions = transactions.filter((t) => t.archivedAt || archivedAgencyIds.has(t.agencyId));
    const agencyPageSize = 12;
    const transactionPageSize = 25;
    const [agencyPage, setAgencyPage] = useState(1);
    const [transactionPage, setTransactionPage] = useState(1);
    const agencyPageCount = Math.max(1, Math.ceil(archivedAgencies.length / agencyPageSize));
    const transactionPageCount = Math.max(1, Math.ceil(archivedTransactions.length / transactionPageSize));
    const shownAgencies = archivedAgencies.slice((agencyPage - 1) * agencyPageSize, agencyPage * agencyPageSize);
    const shownTransactions = archivedTransactions.slice(
        (transactionPage - 1) * transactionPageSize,
        transactionPage * transactionPageSize,
    );
    useEffect(() => setAgencyPage((current) => Math.min(current, agencyPageCount)), [agencyPageCount]);
    useEffect(() => setTransactionPage((current) => Math.min(current, transactionPageCount)), [transactionPageCount]);
    const empty = archivedAgencies.length === 0 && archivedTransactions.length === 0;
    return (
        <section className="panel report-panel">
            <div className="panel-heading">
                <div>
                    <h2>Archived entries</h2>
                    <p>Archived records appear here and are excluded from active lists, balances, reports and ledger PDFs. Restore an entry to include it again; entries belonging to an archived agency require restoring that agency too.</p>
                </div>
            </div>
            {empty && <p className="archive-empty">No archived entries.</p>}
            {archivedAgencies.length > 0 && (
                <>
                    <h3 className="archive-section-title">Archived agencies</h3>
                    {shownAgencies.map((agency) => (
                        <div className="archive-agency-row" key={agency.id}>
                            <span>
                                <b>{agency.name}</b>
                                <small>
                                    {agency.code} · Archived {formatAuditTime(agency.archivedAt!)}
                                </small>
                            </span>
                            <AgencyContactButtons agency={agency} />
                            <button className="outline-button" onClick={() => onRestoreAgency(agency.id)}>
                                <RotateCcw size={14} /> Restore
                            </button>
                        </div>
                    ))}
                    <Pagination page={agencyPage} pageCount={agencyPageCount} onPageChange={setAgencyPage} />
                </>
            )}
            {archivedTransactions.length > 0 && (
                <>
                    <h3 className="archive-section-title">Archived transactions</h3>
                    <TransactionTable
                        transactions={shownTransactions}
                        agencies={agencies}
                        onRestore={onRestoreTransaction}
                    />
                    <Pagination page={transactionPage} pageCount={transactionPageCount} onPageChange={setTransactionPage} />
                </>
            )}
        </section>
    );
}
function TransactionTable({
    transactions,
    agencies,
    onEdit,
    onDelete,
    onArchive,
    onRestore,
}: {
    transactions: Transaction[];
    agencies: Agency[];
    onEdit?: (transaction: Transaction) => void;
    onDelete?: (id: string) => void;
    onArchive?: (id: string) => void;
    onRestore?: (id: string) => void;
}) {
    const hasActions = Boolean(onEdit || onDelete || onArchive || onRestore || transactions.some((t) => t.type === "payment"));
    return (
        <div className={`transaction-list${hasActions ? " has-actions" : ""}`}>
            <div className="transaction-row transaction-head">
                <span>Date</span>
                <span>Agency / voucher</span>
                <span>Description</span>
                <span>Debit</span>
                <span>Credit</span>
                <span>Sync status</span>
                {hasActions && <span>Actions</span>}
            </div>
            {transactions.map((t) => (
                <div className="transaction-row" key={t.id}>
                    <span className="date-cell">
                        <time dateTime={t.date}>{printDate(t.date)}</time>
                    </span>
                    <span>
                        <b>{agencies.find((a) => a.id === t.agencyId)?.name}</b>
                        <small>{t.voucher}{t.reversalOf ? " ? Reversal" : ""}{t.reconciliation ? " ? Bank matched" : ""}{t.archivedAt ? " · Archived" : ""}</small>{t.archivedAt && <small>Archived {formatAuditTime(t.archivedAt)}</small>}
                    </span>
                    <span>
                        <b>
                            {t.type === "sale"
                                ? t.passenger || "Ticket Sales"
                                : t.method || "Payment"}
                        </b>
                        <small>{t.type === "sale" ? t.ticket : t.reference}</small>
                        {t.type === "sale" && t.airlineName?.trim() && <small>Airline: {t.airlineName}</small>}
                        <MigrationTag transaction={t} />
                        {t.type === "sale" && !t.reversalOf && !outgoingMigration(t) && <small>{ticketProfit(t) === null ? "Profit: cost not recorded" : `Ticket cost: ${money(t.ticketCost!)} | Profit: ${ticketProfit(t)! < 0 ? "-" : ""}${money(ticketProfit(t)!)}`}</small>}
                    </span>
                    <span className="debit">
                        {t.type === "sale" ? money(t.amount) : "—"}
                    </span>
                    <span className="credit">
                        {t.type === "payment" ? money(t.amount) : "—"}
                    </span>
                    <span>
                        <SyncBadge status={t.status} />
                    </span>
                    {hasActions && (
                        <span className="transaction-actions">
                            {onRestore && t.archivedAt && <button className="outline-button" onClick={() => onRestore(t.id)}><RotateCcw size={14} /> Restore</button>}
                            {t.type === "payment" && (
                                <button
                                    type="button"
                                    className="outline-button"
                                    aria-label={`Download receipt ${t.voucher}`}
                                    disabled={!agencies.some((agency) => agency.id === t.agencyId)}
                                    onClick={() => {
                                        const agency = agencies.find((item) => item.id === t.agencyId);
                                        if (!agency) return;
                                        void downloadCreditReceiptPdf(agency, {
                                            date: t.date,
                                            voucher: t.voucher,
                                            amount: String(t.amount / 100),
                                            method: t.method || "Bank Transfer",
                                            reference: t.reference || "",
                                            bank: t.bank || "",
                                            sendingBank: t.sendingBank,
                                            receivingBank: t.receivingBank,
                                            sendingBankName: t.sendingBankName,
                                            receivingBankName: t.receivingBankName,
                                            narration: t.narration || "",
                                        });
                                    }}
                                >
                                    <Download size={15} /> Download Receipt
                                </button>
                            )}
                            {!t.archivedAt && (onEdit || onDelete || onArchive) && <TransactionActionMenu transaction={t} onEdit={onEdit} onArchive={onDelete || onArchive} />}
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
}
function SyncBadge({ status }: { status: SyncStatus }) {
    return (
        <span className={`sync-badge ${status}`}>
            {status === "synced" ? (
                <Check size={12} />
            ) : status === "pending" ? (
                <RefreshCw size={12} />
            ) : (
                <AlertTriangle size={12} />
            )}{" "}
            {status === "synced"
                ? (firebaseServices ? "Synced" : "Unverified")
                : status === "pending"
                    ? "Local only"
                    : "Sync failed"}
        </span>
    );
}

const printDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-GB");


function downloadAgencyDirectoryPdf(agencies: Agency[], transactions: Transaction[]) {
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const amount = (value: number) => `BDT ${(Math.abs(value) / 100).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    pdf.setTextColor(17, 57, 54);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text("AEGIS TRAVEL LEDGER", 14, 15);
    pdf.setFontSize(16);
    pdf.text("Agency Directory", 105, 15, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(91, 102, 104);
    pdf.text(`Generated: ${new Date().toLocaleDateString("en-GB")}  |  ${agencies.length} agencies`, 105, 22, { align: "center" });
    pdf.setDrawColor(17, 57, 54);
    pdf.line(12, 28, 198, 28);
    autoTable(pdf, {
        startY: 35,
        theme: "grid",
        styles: { font: "helvetica", fontSize: 8, cellPadding: 4, lineColor: [218, 228, 225], lineWidth: 0.2, valign: "middle" },
        headStyles: { fillColor: [17, 57, 54], textColor: 255, fontSize: 8, fontStyle: "bold" },
        bodyStyles: { textColor: [23, 33, 38] },
        alternateRowStyles: { fillColor: [247, 251, 250] },
        columnStyles: { 0: { cellWidth: 29 }, 1: { cellWidth: 38 }, 2: { cellWidth: 36 }, 3: { cellWidth: 28 }, 4: { cellWidth: 23 }, 5: { cellWidth: 32, halign: "right" } },
        head: [["Code", "Agency", "Contact", "Phone", "Status", "Current balance"]],
        body: agencies.map((agency) => {
            const balance = getBalance(agency, transactions);
            return [agency.code, agency.name, agency.contact, agency.phone, agency.active ? "Active" : "Inactive", `${amount(balance)} ${balanceMeta(balance).side}`];
        }),
        didDrawPage: (data) => { pdf.setFontSize(8); pdf.setTextColor(90, 100, 105); pdf.text(`Aegis Travel Ledger  •  Page ${data.pageNumber}`, 196, 287, { align: "right" }); },
    });
    pdf.save(`agency-directory-${getToday()}.pdf`);
}

function ledgerStatementData(agency: Agency, rows: { t: Transaction; running: number }[], opening: number, dateFrom: string, dateTo: string, totalDebit = 0, totalCredit = 0): StatementData {
    return {
        account: agency.name,
        from: dateFrom,
        to: dateTo,
        opening,
        totalDebit,
        totalCredit,
        rows: rows.map(({ t, running }) => ({
            date: t.date,
            voucher: t.voucher,
            narration: transactionLedgerNarration(t, agency),
            method: t.method || "",
            debit: t.type === "sale" ? t.amount : 0,
            credit: t.type === "payment" ? t.amount : 0,
            balance: running,
        })),
    };
}

async function downloadLedgerPdf(
    agency: Agency,
    rows: { t: Transaction; running: number }[],
    opening: number,
    dateFrom: string,
    dateTo: string,
    totalDebit: number,
    totalCredit: number,
) {
    const logo = await loadPdfImage("/az-air-travels-logo.png");
    const logoDataUrl = logo ?? undefined;
    createLedgerPdf(ledgerStatementData(agency, rows, opening, dateFrom, dateTo, totalDebit, totalCredit), logoDataUrl).save(
        `agency-ledger-${agency.code}-${dateFrom}-to-${dateTo}.pdf`,
    );
}
async function loadPdfImage(path: string) {
    try {
        const response = await fetch(path);
        if (!response.ok) return null;
        const blob = await response.blob();
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unable to read image"));
            reader.onerror = () => reject(reader.error || new Error("Unable to read image"));
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

async function downloadCreditReceiptPdf(agency: Agency, data: { date: string; voucher: string; amount: string; method: string; reference: string; bank?: string; sendingBank?: string; receivingBank?: string; sendingBankName?: string; receivingBankName?: string; narration: string }) {
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const logo = await loadPdfImage("/az-air-travels-logo.png");
    const amount = parseMoney(data.amount);
    const moneyText = (amount / 100).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const amountWords = amountInWords(amount);
    const addressLines = pdf.splitTextToSize(`Address : ${agency.address || ""}`, 150);
    const companyAddress = "H-79, Block-M/1, 4th Floor, Shikder Plaza, Airport Road(Soinik Club Signal) Chairman Bari, Banani, Dhaka-1213,";
    const teal: [number, number, number] = [17, 57, 54];
    const gold: [number, number, number] = [207, 153, 72];
    const ink: [number, number, number] = [38, 48, 51];
    const muted: [number, number, number] = [91, 102, 104];
    pdf.setFillColor(248, 250, 249);
    pdf.rect(0, 0, 210, 297, "F");
    if (logo) pdf.addImage(logo, "PNG", 20, 7, 22, 22);
    pdf.setTextColor(...teal);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.text("A TO Z AIR TRAVELS", 48, 16);
    pdf.setFont("helvetica", "normal");
    pdf.setDrawColor(...teal);
    pdf.setLineWidth(0.35);
    pdf.circle(28, 16, 6, "S");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    if (!logo) pdf.text("A2Z", 28, 18.5, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...muted);
    pdf.setFontSize(8.2);
    pdf.text(pdf.splitTextToSize(companyAddress, 140), 48, 23, { lineHeightFactor: 1.25 });
    pdf.setFontSize(7.8);
    pdf.text("Phone : 01710000048   |   Mobile : 01946111888", 48, 39);
    pdf.text("Customer Accounts", 48, 45);
    pdf.setDrawColor(211, 222, 218);
    pdf.line(20, 52, 190, 52);
    pdf.setTextColor(...teal);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(17);
    pdf.setFont("times", "italic");
    pdf.setTextColor(...teal);
    pdf.text("Robin", 164.5, 246, { align: "center" });
    pdf.setDrawColor(...gold);
    pdf.setLineWidth(0.6);
    pdf.line(145, 249, 184, 249);
    pdf.text("MONEY RECEIPT", 105, 68, { align: "center" });
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(7.5);
    pdf.setTextColor(...ink);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...muted);
    pdf.text(`RECEIPT NO.  ${data.voucher}`, 20, 91);
    pdf.text(`DATED  ${printDate(data.date)}`, 20, 97);
    pdf.text("ISSUED BY  ADMIN", 190, 91, { align: "right" });
    pdf.text("CREATED BY  ADMIN", 190, 97, { align: "right" });
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(211, 222, 218);
    pdf.setLineWidth(0.4);
    pdf.roundedRect(16, 106, 178, 108, 3, 3, "FD");
    pdf.setDrawColor(226, 236, 232);
    pdf.line(23, 116, 187, 116);
    pdf.setTextColor(...muted);
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(9.5);
    pdf.text("Received with thanks from", 23, 128);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...ink);
    pdf.setFontSize(11);
    pdf.text(agency.name, 67, 128);
    pdf.setFont("helvetica", "italic");
    pdf.setTextColor(...muted);
    pdf.setFontSize(9.5);
    pdf.text(addressLines, 23, 140, { lineHeightFactor: 1.35 });
    pdf.text("the sum of taka in words", 23, 157);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...ink);
    let wordsSize = 9.5;
    while (pdf.splitTextToSize(amountWords, 120).length > 2 && wordsSize > 6) {
        wordsSize -= 0.5;
        pdf.setFontSize(wordsSize);
    }
    pdf.text(pdf.splitTextToSize(amountWords, 120), 67, 157, { lineHeightFactor: 1.1 });
    pdf.setFontSize(9.5);
    pdf.setFont("helvetica", "italic");
    pdf.setTextColor(...muted);
    pdf.setFont("helvetica", "normal");
    const sendingBank = data.sendingBank === "Other Bank" ? data.sendingBankName : data.sendingBank;
    const receivingBank = data.receivingBank === "Other Bank" ? data.receivingBankName : data.receivingBank;
    const bankDetail = sendingBank && receivingBank
        ? `${sendingBank} to ${receivingBank}`
        : data.bank || sendingBank || receivingBank || "";
    pdf.text(`By ${data.method}${bankDetail ? ` (${bankDetail})` : ""} on Dated : ${printDate(data.date)}`, 23, 169);
    pdf.text(`Cash Received From : ${agency.name}`, 23, 178);
    if (data.reference) pdf.text(`Reference : ${data.reference}`, 23, 185);
    if (data.narration) pdf.text(`Narration : ${data.narration}`, 23, 193);
    pdf.setFillColor(237, 247, 243);
    pdf.roundedRect(23, 198, 164, 12, 2, 2, "F");
    pdf.setTextColor(...teal);
    pdf.setFont("helvetica", "bold");
    pdf.text("PAYMENT AMOUNT", 29, 206);
    pdf.setFontSize(13);
    pdf.text(`BDT ${moneyText}`, 181, 206, { align: "right" });
    pdf.setDrawColor(...gold);
    pdf.setLineWidth(0.6);
    pdf.line(145, 249, 184, 249);
    pdf.setTextColor(...muted);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    pdf.text("Received By", 164.5, 255, { align: "center" });
    pdf.setFontSize(8);
    pdf.text(`${printDate(data.date)}  ·  A TO Z AIR TRAVELS`, 23, 270);
    const generatedAt = new Date().toLocaleString("en-GB", {
        timeZone: "Asia/Dhaka",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
    pdf.text(`Generated: ${generatedAt} (UTC+06:00)`, 187, 270, { align: "right" });
    pdf.setDrawColor(211, 222, 218);
    pdf.line(20, 278, 190, 278);
    pdf.setTextColor(125, 139, 136);
    pdf.setFontSize(7.5);
    pdf.text("Thank you for your business", 105, 285, { align: "center" });
    pdf.save(`credit-receipt-${data.voucher || "receipt"}.pdf`);
}

function LedgerProfit({ transaction }: { transaction: Transaction }) {
    if (isTaxRefund(transaction)) return <span className="ledger-profit"><b>-{money(transaction.amount)}</b><small>Tax refund</small></span>;
    const profit = ticketProfit(transaction);
    return <span className="ledger-profit" title="Profit margin = profit / ticket sales amount x 100">
        {transaction.type !== "sale" || transaction.reversalOf || outgoingMigration(transaction) ? "—" : profit === null ? <small>Cost not recorded</small> : <>
            <b>{profit < 0 ? "-" : ""}{money(profit)}</b>
            <small>{((profit / transaction.amount) * 100).toFixed(2)}% margin</small>
        </>}
    </span>;
}

function LedgerPage({
    agencies,
    transactions,
    selected,
    setSelected,
    onAddSale,
    onAddCredit,
    onEdit,
    onDelete,
}: {
    agencies: Agency[];
    transactions: Transaction[];
    selected: string;
    setSelected: (id: string) => void;
    onAddSale: () => void;
    onAddCredit: () => void;
    onEdit: (transaction: Transaction) => void;
    onDelete: (id: string) => void;
}) {
    const agency = agencies.find((a) => a.id === selected) || agencies[0];
    const [dateFrom, setDateFrom] = useState(() => ledgerDateWindow(getToday()).from);
    const [dateTo, setDateTo] = useState(() => ledgerDateWindow(getToday()).to);
    const [ledgerPage, setLedgerPage] = useState(1);
    const ledgerPageSize = 50;
    const validRange = Boolean(
        agency &&
            dateFrom &&
            dateTo &&
            dateFrom <= dateTo,
    );
    const ledger = validRange && agency && (!agency.openingDate || dateTo >= agency.openingDate)
        ? calculateLedger(agency, transactions, agency.openingDate && dateFrom < agency.openingDate ? agency.openingDate : dateFrom, dateTo)
        : { opening: 0, closing: 0, rows: [], totalDebit: 0, totalCredit: 0 };
    const { opening, closing: running, rows: mapped, totalDebit, totalCredit } = ledger;
    const profit = profitSummary(mapped.map(({ t }) => t), transactions);
    const ledgerPageCount = Math.max(1, Math.ceil(mapped.length / ledgerPageSize));
    const ledgerPageStart = (ledgerPage - 1) * ledgerPageSize;
    const shownLedgerRows = mapped.slice(ledgerPageStart, ledgerPage * ledgerPageSize);
    useEffect(() => setLedgerPage(1), [agency?.id, dateFrom, dateTo]);
    useEffect(() => setLedgerPage((current) => Math.min(current, ledgerPageCount)), [ledgerPageCount]);
    if (!agency) return <p>Create an agency to view its ledger.</p>;
    return (
        <>
            <div className="ledger-toolbar">
                <AgencySelect agencies={agencies} value={agency.id} onChange={setSelected} />
                <div className="date-filter">
                    <CalendarDays size={16} />
                    <input className="ledger-date-input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                    <span>to</span>
                    <input className="ledger-date-input" type="date" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)} />
                </div>
                <div className="ledger-actions">
                    <button className="ledger-action sale-action" onClick={onAddSale}>
                        <Plus size={16} /> Add Ticket Sale
                    </button>
                    <button className="ledger-action credit-action" onClick={onAddCredit}>
                        <ArrowDownLeft size={16} /> Add Credit
                    </button>
                    <button
                        className="outline-button"
                        title="Download all entries for this agency, across all dates"
                        onClick={() => {
                            const full = completeLedger(agency, transactions, getToday());
                            void downloadLedgerPdf(
                                agency,
                                full.rows,
                                full.opening,
                                full.from,
                                full.to,
                                full.totalDebit,
                                full.totalCredit,
                            );
                        }}
                    >
                        <Download size={15} /> Download PDF
                    </button>
                </div>
            </div>
            {!validRange && <p role="alert">Select a valid date range. From must be on or before To.</p>}
            {validRange && <>
                <div className="ledger-summary">
                    <div>
                        <span>Reporting period</span>
                        <b>{printDate(dateFrom)} — {printDate(dateTo)}</b>
                    </div>
                    <div>
                        <span>Opening balance</span>
                        <b>
                            {money(Math.abs(opening))} {balanceMeta(opening).side}
                        </b>
                    </div>
                    <div>
                        <span>Total debit</span>
                        <b className="debit">{money(totalDebit)}</b>
                    </div>
                    <div>
                        <span>Total credit</span>
                        <b className="credit">{money(totalCredit)}</b>
                    </div>
                    <div>
                        <span>Total profit</span>
                        <b>{profit.total < 0 ? "-" : ""}{money(profit.total)}</b>
                        {profit.missingCosts > 0 && <small>Partial total: {profit.missingCosts} entries missing cost</small>}
                    </div>
                    <div className="closing">
                        <span>Closing balance</span>
                        <b>
                            {money(balanceMeta(running).value)} {balanceMeta(running).side}
                        </b>
                    </div>
                </div>
                <section className="panel ledger-panel">
                    <div className="panel-heading">
                        <div>
                            <h2>{agency.name}</h2>
                            <p>General ledger · {mapped.length} entries in range</p>
                        </div>
                        <button className="icon-button">
                            <MoreHorizontal size={18} />
                        </button>
                    </div>
                    <div className="ledger-table">
                        <div className="ledger-row ledger-head">
                            <span>Date</span>
                            <span>Voucher / description</span>
                            <span>Payment mode</span>
                            <span>Debit</span>
                            <span>Credit</span>
                            <span className="ledger-profit">Profit</span>
                            <span>Actions</span>
                        </div>
                        {shownLedgerRows.map(({ t }) => (
                            <div className="ledger-row" key={t.id}>
                                <span>{printDate(t.date)}</span>
                                <span>
                                    <b>{t.voucher}{t.archivedAt ? " · Archived" : ""}</b>
                                    <small className="ledger-description">
                                        {transactionLedgerNarration(t, agency)}
                                    </small>

                                </span>
                                <span>{t.method || "—"}</span>
                                <span className="debit ledger-amount">
                                    {t.type === "sale" ? money(t.amount) : "—"}
                                    {t.type === "sale" && <MigrationTag transaction={t} />}
                                </span>
                                <span className="credit ledger-amount">
                                    {t.type === "payment" ? money(t.amount) : "—"}
                                    {t.type === "payment" && (
                                        <button
                                            className="credit-download"
                                            title="Download credit receipt PDF"
                                            aria-label={`Download receipt for ${t.voucher}`}
                                            onClick={() => downloadCreditReceiptPdf(agency, {
                                                date: t.date,
                                                voucher: t.voucher,
                                                amount: String(t.amount / 100),
                                                method: t.method || "Bank Transfer",
                                                reference: t.reference || "",
                                                bank: t.bank || "",
                                                sendingBank: t.sendingBank,
                                                receivingBank: t.receivingBank,
                                                sendingBankName: t.sendingBankName,
                                                receivingBankName: t.receivingBankName,
                                                narration: t.narration || "",
                                            })}
                                        >
                                            <Download size={12} />
                                        </button>
                                    )}
                                    {t.type === "payment" && <MigrationTag transaction={t} />}
                                </span>
                                <LedgerProfit transaction={t} />
                                <span className="ledger-row-actions">
                                    <TransactionActionMenu transaction={t} onEdit={onEdit} onArchive={onDelete} />
                                </span>
                            </div>
                        ))}
                    </div>
                    <Pagination page={ledgerPage} pageCount={ledgerPageCount} onPageChange={setLedgerPage} />
                </section>
            </>}
        </>
    );
}

function Reports({
    agencies,
    transactions,
    onEdit,
    onDelete,
}: {
    agencies: Agency[];
    transactions: Transaction[];
    onEdit?: (transaction: Transaction) => void;
    onDelete?: (id: string) => void;
}) {
    const [tab, setTab] = useState("summary");
    const [page, setPage] = useState(1);
    const pageSize = 25;
    const balanceRows = useMemo(
        () =>
            agencies
                .map((a) => ({ agency: a, balance: getBalance(a, transactions) }))
                .sort((a, b) => b.balance - a.balance),
        [agencies, transactions],
    );
    const reportTransactions = useMemo(
        () =>
            transactions.filter((t) =>
                tab === "sales" ? t.type === "sale" : tab === "payments" ? t.type === "payment" : true,
            ),
        [transactions, tab],
    );
    const listLength = tab === "summary" ? balanceRows.length : reportTransactions.length;
    const pageCount = Math.max(1, Math.ceil(listLength / pageSize));
    const shownBalances = balanceRows.slice((page - 1) * pageSize, page * pageSize);
    const shownReportTransactions = reportTransactions.slice((page - 1) * pageSize, page * pageSize);
    useEffect(() => setPage(1), [tab]);
    useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
    const exportCsv = () => {
        const rows = [
            ["Date", "Agency", "Type", "Voucher", "Debit", "Credit"],
            ...transactions.map((t) => [
                t.date,
                agencies.find((a) => a.id === t.agencyId)?.name || "",
                t.type,
                t.voucher,
                t.type === "sale" ? String(t.amount / 100) : "0",
                t.type === "payment" ? String(t.amount / 100) : "0",
            ]),
        ];
        const blob = new Blob([encodeCsv(rows)], {
            type: "text/csv",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "aegis-ledger-report.csv";
        anchor.click();
        URL.revokeObjectURL(url);
    };
    return (
        <>
            <div className="report-header">
                <div>
                    <p>Analyze, export, and share your ledger data.</p>
                </div>
                <div className="report-actions">
                    <button className="outline-button" onClick={() => window.print()}>
                        <Download size={15} /> PDF / Print
                    </button>
                    <button className="primary-button" onClick={exportCsv}>
                        <FileSpreadsheet size={16} /> Excel / CSV
                    </button>
                </div>
            </div>
            <div className="tabs">
                <button
                    className={tab === "summary" ? "active" : ""}
                    onClick={() => setTab("summary")}
                >
                    All balances
                </button>
                <button
                    className={tab === "sales" ? "active" : ""}
                    onClick={() => setTab("sales")}
                >
                    Ticket Sales
                </button>
                <button
                    className={tab === "payments" ? "active" : ""}
                    onClick={() => setTab("payments")}
                >
                    Payment Receipts
                </button>
                <button
                    className={tab === "statement" ? "active" : ""}
                    onClick={() => setTab("statement")}
                >
                    Agency statement
                </button>
            </div>
            {tab === "summary" ? (
                <section className="panel report-panel">
                    <div className="panel-heading">
                        <div>
                            <h2>All-agency balance summary</h2>
                            <p>All recorded transactions</p>
                        </div>
                        <span className="verified">
                            <Check size={13} /> Verified totals
                        </span>
                    </div>
                    <AgencyBalanceTable rows={shownBalances} />
                    <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
                </section>
            ) : (
                <section className="panel report-panel">
                    <div className="panel-heading">
                        <div>
                            <h2>
                                {tab === "sales"
                                    ? "Ticket Sales Report"
                                    : tab === "payments"
                                        ? "Payment Report"
                                        : "Agency statement"}
                            </h2>
                            <p>{reportTransactions.length} recorded transactions</p>
                        </div>
                    </div>
                    <TransactionTable
                        transactions={shownReportTransactions}
                        agencies={agencies}
                        onEdit={onEdit}
                        onDelete={onDelete}
                    />
                    <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
                </section>
            )}
        </>
    );
}
function Settings({ pending, snapshot }: { pending: number; snapshot: LedgerSnapshot<Agency, Transaction> }) {
    return (
        <div className="settings-grid">
            <section className="panel settings-panel">
                <div className="panel-heading">
                    <div>
                        <h2>Offline and sync</h2>
                        <p>Device data and server connection</p>
                    </div>
                    <Cloud size={19} />
                </div>
                <div className="setting-row">
                    <div className="setting-icon">
                        <RefreshCw size={17} />
                    </div>
                    <div>
                        <b>Pending sync</b>
                        <span>
                            {firebaseServices ? "Cloud changes require server confirmation" : pending
                                ? `${pending} entries waiting to sync`
                                : "Server sync is not configured"}
                        </span>
                    </div>
                    <span className={pending ? "status-dot pending" : "status-dot"} />
                </div>
                <div className="setting-row">
                    <div className="setting-icon">
                        <ShieldCheck size={17} />
                    </div>
                    <div>
                        <b>Data protection</b>
                        <span>
                            {firebaseServices ? "Firestore storage with authenticated access, atomic saves and protected activity history. Download backups regularly." : "Browser storage and local queue only. No server backup is configured."}
                        </span>
                    </div>
                    <Check size={16} className="green-check" />
                </div>
            </section>
            <section className="panel settings-panel">
                <div className="panel-heading">
                    <div>
                        <h2>Import and backup</h2>
                        <p>Safely add historical records</p>
                    </div>
                </div>
                <button className="setting-action" onClick={() => {
                    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
                    const link = document.createElement("a"); link.href = url; link.download = `ledger-backup-${getToday()}.json`; link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}><Download size={17} /><span><b>Download ledger backup</b><small>Agencies, transactions and activity history as JSON</small></span></button>
                <button className="setting-action" disabled title="Not available yet">
                    <Upload size={17} />
                    <span>
                        <b>Spreadsheet import</b>
                        <small>CSV or Excel · preview and reconciliation required</small>
                    </span>
                    <ChevronRight size={16} />
                </button>
                <button className="setting-action" disabled title="Not available yet">
                    <FileBarChart size={17} />
                    <span>
                        <b>PDF statement import</b>
                        <small>Not available yet</small>
                    </span>
                    <ChevronRight size={16} />
                </button>
                <div className="warning-box">
                    <AlertTriangle size={17} />
                    <span>
                        {firebaseServices ? "Firestore is the source of truth. Review backup and restore settings in Firebase Console." : "Export your records before clearing browser data. Browser data can be lost; server backup is not configured."}
                    </span>
                </div>
            </section>
        </div>
    );
}

function DeleteConfirmModal({
    title,
    label,
    onClose,
    onConfirm,
}: {
    title: string;
    label: string;
    onClose: () => void;
    onConfirm: () => void;
}) {
    const [challengeCode] = useState(createChallengeCode);
    const [inputCode, setInputCode] = useState("");
    return (
        <div className="modal-backdrop">
            <div className="modal delete-modal">
                <div className="modal-head">
                    <div>
                        <h2>{title}</h2>
                        <p>{title.startsWith("Archive") ? `This will hide ${label} from active lists.` : `This action is permanent for ${label}.`}</p>
                    </div>
                    <button className="icon-button" onClick={onClose}>
                        <X size={19} />
                    </button>
                </div>
                <div className="delete-confirm-body">
                    <div className="delete-code-box">
                        <span>Confirmation code</span>
                        <strong>{challengeCode}</strong>
                    </div>
                    <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="Type the 6-character code"
                        value={inputCode}
                        onChange={(event) =>
                            setInputCode(event.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6))
                        }
                    />
                    <div className="form-footer">
                        <span>
                            <AlertTriangle size={14} /> {title.startsWith("Archive") ? "You can restore this later." : "This cannot be undone."}
                        </span>
                        <div>
                            <button className="outline-button" onClick={onClose}>
                                Cancel
                            </button>
                            <button
                                className="danger-button"
                                onClick={onConfirm}
                                disabled={inputCode !== challengeCode}
                            >
                                {title.startsWith("Archive") ? "Archive now" : "Delete now"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ModalShell({
    title,
    subtitle,
    children,
    onClose,
    className = "",
}: {
    className?: string;
    title: string;
    subtitle: string;
    children: React.ReactNode;
    onClose: () => void;
}) {
    return (
        <div className="modal-backdrop">
            <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}>
                <div className="modal-head">
                    <div>
                        <h2>{title}</h2>
                        <p>{subtitle}</p>
                    </div>
                    <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>
                        <X size={19} />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}
function Field({
    label,
    children,
    required = false,
}: {
    label: string;
    children: React.ReactNode;
    required?: boolean;
}) {
    return (
        <label className="field">
            <span>
                {label}
                {required && <i>*</i>}
            </span>
            {children}
        </label>
    );
}
function SaleForm({
    agencies,
    initialAgencyId,
    initialTransaction,
    onClose,
    onSave,
    online,
}: {
    agencies: Agency[];
    initialAgencyId?: string;
    initialTransaction?: Transaction;
    onClose: () => void;
    onSave: (t: Transaction) => void | Promise<void>;
    online: boolean;
}) {
    const notify = useContext(ToastContext);
    const [data, setData] = useState({
        agencyId: initialTransaction?.agencyId || initialAgencyId || agencies.find(a => a.active && !a.archivedAt)?.id || "",
        date: initialTransaction?.date || getToday(),
        voucher: initialTransaction?.voucher || createVoucher("V", initialTransaction?.date || getToday()),
        reference: initialTransaction?.reference || "",
        ticket: initialTransaction?.ticket || "",
        passenger: initialTransaction?.passenger || "",
        sector: initialTransaction?.sector || "",
        flightDate: initialTransaction?.flightDate || "",
        airlineCode: initialTransaction?.airlineCode || "",
        airlineName: initialTransaction?.airlineName || "",
        ticketCost: initialTransaction?.ticketCost === undefined ? "" : String(initialTransaction.ticketCost / 100),
        amount: initialTransaction ? String(initialTransaction.amount / 100) : "",
        narration: initialTransaction?.narration || "",
    });
    const safety=useFormSafety(data,onClose);
    const profit = (() => {
        try { return parseMoney(data.amount) - parseMoney(data.ticketCost, true); }
        catch { return null; }
    })();
    const set = (key: string, value: string) =>
        setData((d) => ({ ...d, [key]: value }));
    const submit = async () => {
        if(!safety.start()) return;
        try {
            if (!data.agencyId || !data.date || !data.voucher.trim() || !data.ticket.trim() || !data.passenger.trim() || !data.amount)
                throw new Error("Please complete all required sale fields.");
            if (!initialTransaction && !data.ticketCost) throw new Error("Enter the ticket amount (cost).");
            if (data.airlineCode === "OTHER" && !data.airlineName.trim()) throw new Error("Enter the other airline name.");
            await onSave({
                ...data,
                airlineName: data.airlineName.trim(),
                id: initialTransaction?.id || id("sale"),
                type: "sale",
                ticketCost: data.ticketCost === "" ? undefined : parseMoney(data.ticketCost, true),
                amount: parseMoney(data.amount),
                status: "pending",
                createdAt: initialTransaction?.createdAt || new Date().toISOString(),
            });
            notify("success", initialTransaction ? "Sale updated successfully." : "Sale saved successfully.");
            onClose();
        } catch (error) { safety.fail(error); notify("error", error instanceof Error ? error.message : "Unable to save record."); } finally { safety.finish(); }
    };
    return (
        <ModalShell
            title={initialTransaction ? "Edit ticket sale" : "Add ticket sale"}
            subtitle="The ticket sales amount will be posted as a debit to the selected agency ledger"
            onClose={safety.close}
        >
            {safety.error && <p className="form-save-error" role="alert">{safety.error} Your entries are still in this form.</p>}
            <div className="form-grid">
                <Field label="Agency" required>
                    <select
                        value={data.agencyId}
                        onChange={(e) => set("agencyId", e.target.value)}
                    >
                        {agencies
                            .filter((a) => (a.active && !a.archivedAt) || a.id === initialTransaction?.agencyId)
                            .map((a) => (
                                <option key={a.id} value={a.id}>
                                    {a.name}
                                </option>
                            ))}
                    </select>
                </Field>
                <Field label="Posting date" required>
                    <input
                        type="date"
                        value={data.date}
                        onChange={(e) => set("date", e.target.value)}
                    />
                </Field>
                <Field label="Voucher number" required>
                    <input
                        placeholder="V-260923-012"
                        value={data.voucher}
                        onChange={(e) => set("voucher", e.target.value)}
                    />
                </Field>
                <Field label="Reference number">
                    <input
                        placeholder="REF-90507"
                        value={data.reference}
                        onChange={(e) => set("reference", e.target.value)}
                    />
                </Field>
                <Field label="Ticket number" required>
                    <input
                        placeholder="ET-220349901"
                        value={data.ticket}
                        onChange={(e) => set("ticket", e.target.value)}
                    />
                </Field>
                <Field label="Passenger name" required>
                    <input
                        placeholder="Passenger full name"
                        value={data.passenger}
                        onChange={(e) => set("passenger", e.target.value)}
                    />
                </Field>
                <Field label="Sector / route">
                    <input
                        placeholder="DAC - DXB"
                        value={data.sector}
                        onChange={(e) => set("sector", e.target.value)}
                    />
                </Field>
                <AirlineSelect value={data.airlineCode} onChange={(airlineCode, airlineName) => setData(current => ({ ...current, airlineCode, airlineName: airlineCode === "OTHER" && current.airlineCode === "OTHER" ? current.airlineName : airlineName }))} />
                {data.airlineCode === "OTHER" && <Field label="Other airline name" required>
                    <input placeholder="Enter airline name" value={data.airlineName} maxLength={4000} onChange={event => set("airlineName", event.target.value)} />
                </Field>}
                <Field label="Flight date">
                    <input
                        type="date"
                        value={data.flightDate}
                        onChange={(e) => set("flightDate", e.target.value)}
                    />
                </Field>
                <Field label="Ticket amount / cost (BDT)" required={!initialTransaction}>
                    <input type="number" min="0" step="0.01" placeholder="0.00" value={data.ticketCost} onChange={(e) => set("ticketCost", e.target.value)} />
                </Field>
                <Field label="Ticket sales amount (BDT)" required>
                    <div className="money-input">
                        <span>৳</span>
                        <input
                            type="number"
                            placeholder="0.00"
                            value={data.amount}
                            onChange={(e) => set("amount", e.target.value)}
                        />
                    </div>
                </Field>
                <Field label="Profit (BDT)">
                    <output aria-live="polite">{profit === null ? "Enter ticket cost and sales amount" : `${profit < 0 ? "-" : ""}${money(profit)}`}</output>
                </Field>
                <Field label="Notes / narration">
                    <input
                        placeholder="Optional note"
                        value={data.narration}
                        onChange={(e) => set("narration", e.target.value)}
                    />
                </Field>
            </div>
            <FormFooter savingOverride={safety.busy} onClose={safety.close} onSave={submit} offline={!online} />
        </ModalShell>
    );
}
function PaymentForm({
    agencies,
    initialAgencyId,
    initialTransaction,
    onClose,
    onSave,
    online,
}: {
    agencies: Agency[];
    initialAgencyId?: string;
    initialTransaction?: Transaction;
    onClose: () => void;
    onSave: (t: Transaction) => void | Promise<void>;
    online: boolean;
}) {
    const notify = useContext(ToastContext);
    const [data, setData] = useState({
        agencyId: initialTransaction?.agencyId || initialAgencyId || agencies.find(a => a.active && !a.archivedAt)?.id || "",
        date: initialTransaction?.date || getToday(),
        voucher: initialTransaction?.voucher || createVoucher("RC", initialTransaction?.date || getToday()),
        reference: initialTransaction?.reference || "",
        amount: initialTransaction ? String(initialTransaction.amount / 100) : "",
        method: initialTransaction?.method || "Bank Transfer",
        sendingBank: initialTransaction?.sendingBank || "",
        receivingBank: initialTransaction?.receivingBank || "",
        sendingBankName: initialTransaction?.sendingBankName || "",
        receivingBankName: initialTransaction?.receivingBankName || "",
        chequeNumber: initialTransaction?.chequeNumber || "",
        chequeDate: initialTransaction?.chequeDate || getToday(),
        walletNumber: initialTransaction?.walletNumber || "",
        narration: initialTransaction?.narration || "",
    });
    const safety=useFormSafety(data,onClose);
    const set = (key: string, value: string) =>
        setData((d) => ({ ...d, [key]: value }));
    const submit = async () => {
        if(!safety.start()) return;
        try {
            if (!data.agencyId || !data.date || !data.voucher.trim() || !data.amount)
                throw new Error("Please complete all required payment fields.");
            validatePaymentDetails({ ...data, type: "payment" });
            await onSave({
                ...data,
                id: initialTransaction?.id || id("payment"),
                type: "payment",
                amount: parseMoney(data.amount),
                status: "pending",
                createdAt: initialTransaction?.createdAt || new Date().toISOString(),
            });
            notify("success", initialTransaction ? "Payment updated successfully." : "Payment saved successfully.");
            onClose();
        } catch (error) { safety.fail(error); notify("error", error instanceof Error ? error.message : "Unable to save record."); } finally { safety.finish(); }
    };
    return (
        <ModalShell
            title={initialTransaction ? "Edit credit entry" : "Add Credit Entry"}
            subtitle="This receipt will be posted as a credit to the selected agency ledger"
            onClose={safety.close}
        >
            {safety.error && <p className="form-save-error" role="alert">{safety.error} Your entries are still in this form.</p>}
            <div className="credit-form">
                <div className="credit-form-intro"><div className="credit-form-icon"><ArrowDownLeft size={20} /></div><div><strong>Agency payment</strong><span>Reduce the outstanding balance or record an advance credit.</span></div><span className="credit-badge">CREDIT</span></div>
                {safety.error && <p className="form-save-error" role="alert">{safety.error} Your entries are still in this form.</p>}
            <div className="form-grid">
                    <Field label="Agency" required>
                        <select
                            value={data.agencyId}
                            onChange={(e) => set("agencyId", e.target.value)}
                        >
                            {agencies
                                .filter((a) => (a.active && !a.archivedAt) || a.id === initialTransaction?.agencyId)
                                .map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.name}
                                    </option>
                                ))}
                        </select>
                    </Field>
                    <Field label="Receipt date" required>
                        <input
                            type="date"
                            value={data.date}
                            onChange={(e) => set("date", e.target.value)}
                        />
                    </Field>
                    <Field label="Receipt / voucher" required>
                        <input
                            placeholder="RC-260923-010"
                            value={data.voucher}
                            onChange={(e) => set("voucher", e.target.value)}
                        />
                    </Field>
                    <Field label="Transaction reference">
                        <input
                            placeholder="NBL-88395"
                            value={data.reference}
                            onChange={(e) => set("reference", e.target.value)}
                        />
                    </Field>
                    <Field label="Amount (BDT)" required>
                        <div className="money-input">
                            <span>৳</span>
                            <input
                                type="number"
                                placeholder="0.00"
                                value={data.amount}
                                onChange={(e) => set("amount", e.target.value)}
                            />
                        </div>
                    </Field>
                    <Field label="Payment method" required>
                        <div className="payment-methods">
                            {["Bank Transfer", "Cheque", "Nagad", "bKash", "Rocket", "Cash"].map((method) => <button type="button" key={method} className={data.method === method ? "method-option active" : "method-option"} onClick={() => set("method", method)}>{method}</button>)}
                        </div>
                    </Field>
                    {data.method === "Bank Transfer" && <>
                        <Field label="Sending bank" required>
                            <select value={data.sendingBank} onChange={(e) => { set("sendingBank", e.target.value); if (e.target.value !== "Other Bank") set("sendingBankName", ""); }}>
                                <option value="">Select sending bank</option>
                                {bangladeshBanks.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
                            </select>
                        </Field>
                        {data.sendingBank === "Other Bank" && <Field label="Sending bank name" required>
                            <input placeholder="Type sending bank name" value={data.sendingBankName} onChange={(e) => set("sendingBankName", e.target.value)} />
                        </Field>}
                        <Field label="Receiving bank" required>
                            <select value={data.receivingBank} onChange={(e) => { set("receivingBank", e.target.value); if (e.target.value !== "Other Bank") set("receivingBankName", ""); }}>
                                <option value="">Select receiving bank</option>
                                {bangladeshBanks.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
                            </select>
                        </Field>
                        {data.receivingBank === "Other Bank" && <Field label="Receiving bank name" required>
                            <input placeholder="Type receiving bank name" value={data.receivingBankName} onChange={(e) => set("receivingBankName", e.target.value)} />
                        </Field>}
                    </>}
                    {data.method === "Cheque" && <>
                        <Field label="Cheque number" required>
                            <input placeholder="CHQ-000123" value={data.chequeNumber} onChange={(e) => set("chequeNumber", e.target.value)} />
                        </Field>
                        <Field label="Cheque date" required>
                            <input type="date" value={data.chequeDate} onChange={(e) => set("chequeDate", e.target.value)} />
                        </Field>
                    </>}
                    {["Nagad", "bKash", "Rocket"].includes(data.method) && <Field label={`${data.method} number`} required>
                        <input type="tel" inputMode="numeric" placeholder="01XXXXXXXXX" value={data.walletNumber} onChange={(e) => set("walletNumber", e.target.value)} />
                    </Field>}
                    <Field label="Notes / narration">
                        <input
                            placeholder="Optional note"
                            value={data.narration}
                            onChange={(e) => set("narration", e.target.value)}
                        />
                    </Field>
                </div>
            </div>
            <FormFooter savingOverride={safety.busy} onClose={safety.close} onSave={submit} offline={!online} />
        </ModalShell>
    );
}
function FormFooter({
    savingOverride = false,
    onClose,
    onSave,
    offline,
}: {
    savingOverride?: boolean;
    onClose: () => void;
    onSave: () => void;
    offline: boolean;
}) {
    const saving = Boolean(useCloudLedger()?.busy) || savingOverride;
    return (
        <div className="form-footer">
            <span>
                {firebaseServices ? <>Changes save after server confirmation</> : offline ? (
                    <>
                        <CloudOff size={14} /> Will save offline · Pending Sync
                    </>
                ) : (
                    <>
                        <ShieldCheck size={14} /> Will save in this browser
                    </>
                )}
            </span>
            <div>
                <button className="outline-button" disabled={saving} onClick={onClose}>
                    Cancel
                </button>
                <button className="primary-button" disabled={saving} onClick={onSave}>
                    <Check size={16} /> {saving ? "Saving?" : "Save entry"}
                </button>
            </div>
        </div>
    );
}
function AgencyModal({
    initialData,
    onClose,
    onSave,
}: {
    initialData?: Agency;
    onClose: () => void;
    onSave: (a: Agency) => void | Promise<void>;
}) {
    const notify = useContext(ToastContext);
    const saving = Boolean(useCloudLedger()?.busy);
    const [data, setData] = useState({
        code: initialData?.code || "",
        name: initialData?.name || "",
        contact: initialData?.contact || "",
        phone: initialData?.phone || "",
        address: initialData?.address || "",
        opening: initialData ? String(initialData.opening / 100) : "",
        openingSide: initialData?.openingSide || ("Dr" as "Dr" | "Cr"),
        openingDate: initialData ? initialData.openingDate || "" : getToday(),
    });
    const safety=useFormSafety(data,onClose);
    const set = (key: string, value: string) =>
        setData((d) => ({ ...d, [key]: value }));
    return (
        <ModalShell
            title={initialData ? "Update agency" : "New agency"}
            subtitle="Agency profile and verified opening balance"
            onClose={safety.close}
        >
            {safety.error && <p className="form-save-error" role="alert">{safety.error} Your entries are still in this form.</p>}
            <div className="form-grid">
                <Field label="Agency code" required>
                    <input
                        placeholder="ABC-001"
                        value={data.code}
                        onChange={(e) => set("code", e.target.value)}
                    />
                </Field>
                <Field label="Agency name" required>
                    <input
                        placeholder="Agency name"
                        value={data.name}
                        onChange={(e) => set("name", e.target.value)}
                    />
                </Field>
                <Field label="Contact person">
                    <input
                        placeholder="Contact person"
                        value={data.contact}
                        onChange={(e) => set("contact", e.target.value)}
                    />
                </Field>
                <Field label="Mobile number">
                    <input
                        placeholder="+880 1..."
                        value={data.phone}
                        onChange={(e) => set("phone", e.target.value)}
                    />
                </Field>
                <Field label="Address">
                    <input
                        placeholder="Address"
                        value={data.address}
                        onChange={(e) => set("address", e.target.value)}
                    />
                </Field>
                <Field label="Opening balance">
                    <div className="money-input">
                        <span>৳</span>
                        <input
                            type="number"
                            placeholder="0.00"
                            value={data.opening}
                            onChange={(e) => set("opening", e.target.value)}
                        />
                    </div>
                </Field>
                <Field label="Opening balance date"><input type="date" value={data.openingDate} onChange={e=>set("openingDate",e.target.value)} /><small>Balance immediately before postings on this date. Blank preserves the legacy undated opening.</small></Field>
                <Field label="Balance side">
                    <select
                        value={data.openingSide}
                        onChange={(e) => set("openingSide", e.target.value as "Dr" | "Cr")}
                    >
                        <option>Dr</option>
                        <option>Cr</option>
                    </select>
                </Field>
            </div>
            <div className="form-footer">
                <span>
                    <ShieldCheck size={14} /> Accounted record
                </span>
                <div>
                    <button className="outline-button" disabled={saving || safety.busy} onClick={safety.close}>
                        Cancel
                    </button>
                    <button
                        className="primary-button" disabled={saving || safety.busy}
                        onClick={async () => {
                            if(!safety.start()) return;
                            try {
                                if (!data.code.trim() || !data.name.trim()) throw new Error("Please enter an agency code and name.");
                                await onSave({
                                    id: initialData?.id || id("agency"),
                                    code: data.code,
                                    name: data.name,
                                    contact: data.contact,
                                    phone: data.phone,
                                    address: data.address,
                                    opening: parseMoney(data.opening || "0", true),
                                    openingSide: data.openingSide,
                                    openingDate: data.openingDate || undefined,
                                    active: initialData?.active ?? true,
                                });
                                notify("success", initialData ? "Agency updated successfully." : "Agency saved successfully.");
                                onClose();
                            } catch (error) { safety.fail(error); notify("error", error instanceof Error ? error.message : "Unable to save agency."); } finally { safety.finish(); }
                        }}
                    >
                        <Check size={16} /> {safety.busy ? "Saving?" : initialData ? "Update agency" : "Save agency"}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}
function MobileNav({ page, go, closeMobileNav }: { page: Page; go: (p: Page) => void; closeMobileNav: () => void }) {
    return (
        <div className="mobile-nav">
            {navItems.slice(0, 5).map((n) => (
                <button
                    key={n.id}
                    className={page === n.id ? "active" : ""}
                    onClick={() => {
                        closeMobileNav();
                        go(n.id);
                    }}
                >
                    <n.icon size={18} />
                    <span>
                        {n.label
                            .replace("Dashboard", "Home")
                            .replace("Ticket Sales", "Tickets")}
                    </span>
                </button>
            ))}
        </div>
    );
}

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        if (import.meta.env.PROD) {
            void navigator.serviceWorker.register("/sw.js");
        } else {
            void navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => void registration.unregister()));
            void caches.keys().then((keys) => keys.forEach((key) => void caches.delete(key)));
        }
    });
}

function formatAuditTime(value: string) {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value)) + " (BD time)";
}
function ActivityLog({ events, agencies }: { events: AuditEvent[]; agencies: Agency[] }) {
    const [query, setQuery] = useState("");
    const [action, setAction] = useState("");
    const labels: Record<string, string> = { amount: "Sales / payment amount", ticketCost: "Ticket cost", opening: "Opening balance", openingSide: "Opening side", agencyId: "Agency", date: "Posting date", createdAt: "Created at", archivedAt: "Archived at", voucher: "Voucher", passenger: "Passenger", flightDate: "Flight date", narration: "Narration", status: "Sync status" };
    const value = (field: string, item: unknown): string => {
        if (item === undefined || item === null || item === "") return "—";
        if ((field === "amount" || field === "ticketCost" || field === "opening") && typeof item === "number") return money(item);
        if (field === "agencyId") return agencies.find(a => a.id === item)?.name || String(item);
        if ((field === "createdAt" || field === "archivedAt") && typeof item === "string") return formatAuditTime(item);
        if ((field === "date" || field === "flightDate" || field === "chequeDate") && typeof item === "string") return printDate(item);
        return typeof item === "object" ? JSON.stringify(item) : String(item);
    };
    const filtered = [...events].reverse().filter(event => (!action || event.action === action) && `${event.label} ${event.entity} ${event.action} ${formatAuditTime(event.timestamp)} ${JSON.stringify(event.before)} ${JSON.stringify(event.after)}`.toLowerCase().includes(query.toLowerCase()));
    const [page, setPage] = useState(1);
    const pageSize = 20;
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const shown = filtered.slice((page - 1) * pageSize, page * pageSize);
    useEffect(() => setPage(1), [query, action]);
    useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
    return <section className="panel audit-panel">
        <div className="panel-heading"><div><h2>Activity Log</h2><p>{filtered.length} matching changes · Bangladesh time (UTC+06:00)</p></div></div>
        <div className="audit-filters">
            <input aria-label="Search activity log" placeholder="Search voucher, agency or changed value" value={query} onChange={event => setQuery(event.target.value)} />
            <select aria-label="Filter activity" value={action} onChange={event => setAction(event.target.value)}><option value="">All actions</option>{["create", "edit", "archive", "restore", "delete", "deactivate", "import", "reverse", "reconcile", "unreconcile", "migrate"].map(item => <option key={item} value={item}>{item}</option>)}</select>
        </div>
        <p className="audit-note">History starts when this feature is enabled. Older actions cannot be reconstructed. {firebaseServices ? "Cloud actions use the authenticated account and server timestamps. Imported local history is marked unverified." : "This log is stored in this browser; users are not authenticated."}</p>
        {filtered.length === 0 && <p className="archive-empty">No matching activity.</p>}
        {shown.map(event => <details className="audit-event" key={event.id}>
            <summary><span className={`audit-action audit-${event.action}`}>{event.action}</span><span><b>{event.label}</b><small>{event.entity} · {event.actor}</small></span><time dateTime={event.timestamp}>{formatAuditTime(event.timestamp)}</time></summary>
            <div className="audit-changes"><table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>{auditChanges(event).map(change => <tr key={change.field}><td>{labels[change.field] || change.field.replace(/([A-Z])/g, " $1")}</td><td>{value(change.field, change.before)}</td><td>{value(change.field, change.after)}</td></tr>)}</tbody></table></div>
            {event.action === "delete" && <p className="audit-note">Deleted record retained in this log. Its amount is no longer included in current balances.</p>}
        </details>)}
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
    </section>;
}

const MigrationContext = createContext<{start:(t:Transaction)=>void;refund:(t:Transaction)=>void;details:(m:NonNullable<Transaction['migration']>)=>void;transactions:Transaction[]}>({start:()=>{},refund:()=>{},details:()=>{},transactions:[]});
function MigrationTag({transaction:t,allowStart=false}:{transaction:Transaction;allowStart?:boolean}) {
 const context=useContext(MigrationContext);
 if(t.migration)return <button type="button" className="migration-tag" onClick={()=>context.details(t.nextMigration || t.migration!)}>Migration history</button>;
 if(!allowStart||t.type!=='sale'||t.archivedAt||t.reversalOf||context.transactions.some(x=>x.reversalOf===t.id))return null;
 return <button type="button" className="outline-button" onClick={()=>context.start(t)}>Migrate</button>;
}
function MigrationRoute({from,to}:{from:string;to:string}) {
 return <div className="migration-route">
  <div><span className="migration-eyebrow">From agency</span><strong><Building2 size={16}/>{from}</strong></div>
  <span className="migration-route-arrow" aria-hidden="true"><ArrowUpRight size={20}/></span>
  <div><span className="migration-eyebrow">To agency</span><strong><Building2 size={16}/>{to}</strong></div>
 </div>;
}
function MigrationHistory({history,agencies}:{history:Transaction[];agencies:Agency[]}) {
 const cost=history[0]?.ticketCost;
 return <section className="migration-ticket"><h3><Ticket size={16}/> Ticket price history</h3>
  <dl className="migration-price-history">
   <div><dt>Original purchase price</dt><dd>{cost===undefined?"Cost not recorded":money(cost)}</dd></div>
   {history.map((entry,index)=><div key={entry.id}><dt>{index+1}. {agencies.find(a=>a.id===entry.agencyId)?.name||entry.agencyId}<small>{entry.date} ? {entry.ticket}</small></dt><dd>{money(entry.amount)}{index===history.length-1&&<small>Current sale</small>}</dd></div>)}
  </dl>
 </section>;
}
function MigrationTotals({purchasePrice,sellingPrice}:{purchasePrice:number|undefined;sellingPrice:number|null}) {
 const profit=sellingPrice===null||purchasePrice===undefined?null:sellingPrice-purchasePrice;
 return <div className="migration-totals" aria-live="polite">
  <div><span>Original purchase price</span><strong>{purchasePrice===undefined?"Unknown":money(purchasePrice)}</strong><small>Ticket buying cost ? BDT</small></div>
  <div><span>Final selling price</span><strong>{sellingPrice===null?"?":money(sellingPrice)}</strong><small>Current destination agency ? BDT</small></div>
  <div className={"migration-profit"+(profit!==null&&profit<0?" is-loss":"")}><span>{profit!==null&&profit<0?"Total loss":"Total profit"}</span><strong>{profit===null?"?":(profit<0?"-":"")+money(profit)}</strong><small>{purchasePrice===undefined?"Cost not recorded":sellingPrice===null?"Enter a selling price":"Final selling price ? original purchase price"}</small></div>
 </div>;
}
function MigrationDetails({migration:m,agencies,transactions,onClose}:{migration:NonNullable<Transaction['migration']>;agencies:Agency[];transactions:Transaction[];onClose:()=>void}) {
 const source=transactions.find(t=>t.id===m.sourceId),sale=transactions.find(t=>t.id===m.saleId);
 const history=source?ticketHistory(source,transactions):[];
 const latest=history[history.length-1];
 return <ModalShell className="migration-modal" title="Ticket migration details" subtitle="A complete summary of this agency transfer" onClose={onClose}>
  <div className="migration-body">
   <div className="migration-status"><span><Check size={14}/> Migration saved</span><time>{formatAuditTime(m.createdAt)}</time></div>
   <MigrationRoute from={agencies.find(a=>a.id===m.fromAgencyId)?.name||m.fromAgencyId} to={agencies.find(a=>a.id===m.toAgencyId)?.name||m.toAgencyId}/>
   <div className="migration-ticket-grid">
    <section className="migration-ticket"><h3><Ticket size={16}/> Original ticket</h3><dl><div><dt>Ticket number</dt><dd>{source?.ticket||'—'}</dd></div><div><dt>Passenger</dt><dd>{source?.passenger||'—'}</dd></div></dl></section>
    <section className="migration-ticket"><h3><Ticket size={16}/> Destination ticket</h3><dl><div><dt>Ticket number</dt><dd>{sale?.ticket||'—'}</dd></div><div><dt>Passenger</dt><dd>{sale?.passenger||'—'}</dd></div></dl></section>
   </div>
   <dl className="migration-metadata"><div><dt>Reference</dt><dd>{sale?.reference||'—'}</dd></div><div><dt>Sector / route</dt><dd>{sale?.sector||'—'}</dd></div><div><dt>Posting date</dt><dd>{sale?.date||'—'}</dd></div><div><dt>Flight date</dt><dd>{sale?.flightDate||'—'}</dd></div></dl>
   <MigrationHistory history={history} agencies={agencies}/>
   <MigrationTotals purchasePrice={history[0]?.ticketCost} sellingPrice={latest?.amount??null}/>
   <p className="migration-note">Profit is counted once under the current agency. Earlier sales remain in this history.</p>
  </div>
  <div className="form-footer migration-details-footer"><span><ShieldCheck size={14}/> Linked agency entries</span><button type="button" className="outline-button" onClick={onClose}>Done</button></div>
 </ModalShell>;
}
function MigrationForm({source,agencies,onClose,onSave}:{source:Transaction;agencies:Agency[];onClose:()=>void;onSave:(r:MigrationRequest)=>Promise<void>}) {
 const [operationId]=useState(()=>crypto.randomUUID());
 const {transactions}=useContext(MigrationContext);
 const original=transactions.find(t=>t.id===source.id)||source;
 const history=ticketHistory(original,transactions);
 const purchasePrice=originalTicketCost(original,transactions);
 const [data,setData]=useState({agencyId:agencies.find(a=>a.id!==source.agencyId&&a.active&&!a.archivedAt)?.id||'',date:getToday()<source.date?source.date:getToday(),ticket:source.ticket||'',passenger:'',reference:'',sector:source.sector||'',flightDate:source.flightDate||'',amount:'',narration:''});
 const safety=useFormSafety(data,onClose),notify=useContext(ToastContext);
 const set=(key:string,value:string)=>setData(d=>({...d,[key]:value}));
 let sellingPrice:number|null=null;try{sellingPrice=parseMoney(data.amount)}catch{}
 const submit=async()=>{if(!safety.start())return;try{
  await onSave({sourceId:source.id,sourcePrice:source.amount,operationId,destination:{...data,type:'sale',amount:parseMoney(data.amount),voucher:'V-'+operationId}});
  notify('success','Migration saved. Source credited and destination debited.');onClose();
 }catch(error){safety.fail(error);notify('error',error instanceof Error?error.message:'Unable to migrate ticket.')}finally{safety.finish()}};
 return <ModalShell className="migration-modal" title="Migrate ticket" subtitle="Set the destination agency, passenger details and selling price" onClose={safety.close}>
 <div className="migration-body migration-form-intro">
  <MigrationRoute from={agencies.find(a=>a.id===source.agencyId)?.name||source.agencyId} to={agencies.find(a=>a.id===data.agencyId)?.name||'Select destination'}/>
  <p className="migration-note"><ShieldCheck size={16}/> Final profit is counted once under the destination agency and included in the main dashboard.</p>
   <MigrationHistory history={history} agencies={agencies}/>
 </div>
 {safety.error&&<p className="form-save-error" role="alert">{safety.error}</p>}
 <div className="form-grid migration-form-grid"><h3 className="migration-section-title"><Building2 size={16}/> Transfer details</h3><Field label="Destination agency" required><select value={data.agencyId} onChange={e=>set('agencyId',e.target.value)}><option value="">Select agency</option>{agencies.filter(a=>a.active&&a.id!==source.agencyId).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
 <Field label="Posting date" required><input type="date" value={data.date} min={source.date} onChange={e=>set('date',e.target.value)}/></Field>
 <h3 className="migration-section-title"><Ticket size={16}/> Ticket &amp; passenger</h3>
 <Field label="Ticket number" required><input placeholder="Ticket number" value={data.ticket} onChange={e=>set('ticket',e.target.value)}/></Field>
 <Field label="New passenger name" required><input placeholder="Passenger full name" value={data.passenger} onChange={e=>set('passenger',e.target.value)}/></Field>
 <Field label="Reference"><input value={data.reference} onChange={e=>set('reference',e.target.value)}/></Field>
 <Field label="Sector / route"><input value={data.sector} onChange={e=>set('sector',e.target.value)}/></Field>
 <Field label="Flight date"><input type="date" value={data.flightDate} onChange={e=>set('flightDate',e.target.value)}/></Field>
 <Field label="Selling price (BDT)" required><input type="number" min="0.01" step="0.01" value={data.amount} onChange={e=>set('amount',e.target.value)}/></Field>

 <Field label="Notes / narration"><input placeholder="Optional notes about this transfer" value={data.narration} onChange={e=>set('narration',e.target.value)}/></Field></div>
 <div className="migration-summary"><MigrationTotals purchasePrice={purchasePrice} sellingPrice={sellingPrice}/></div>
 <FormFooter savingOverride={safety.busy} onClose={safety.close} onSave={submit} offline={!navigator.onLine}/></ModalShell>;
}

function TransactionActionMenu({transaction:t,onEdit,onArchive}:{transaction:Transaction;onEdit?:(t:Transaction)=>void;onArchive?:(id:string)=>void}) {
 const cloud=useCloudLedger();
 const context=useContext(MigrationContext),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState<{left:number;top:number}|null>(null);
 const locked=Boolean(t.archivedAt||t.migration||t.reversalOf||t.reconciliation||context.transactions.some(x=>x.reversalOf===t.id));
 const close=()=>{setPosition(null);trigger.current?.focus()};
 useEffect(()=>{
  if(!position)return;
  panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  const outside=(e:PointerEvent)=>{if(e.target instanceof Node&&!panel.current?.contains(e.target)&&!trigger.current?.contains(e.target))setPosition(null)};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close()}};
  const move=()=>setPosition(null);
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);window.addEventListener('resize',move);window.addEventListener('scroll',move,true);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);window.removeEventListener('resize',move);window.removeEventListener('scroll',move,true)};
 },[position]);
 const choose=(action:()=>void)=>{close();action()};
 return <><button ref={trigger} type="button" className="icon-button transaction-menu-trigger" aria-label={`Actions for ${t.voucher}`} aria-haspopup="menu" aria-expanded={Boolean(position)} onClick={()=>{if(position){close();return}const rect=trigger.current!.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(rect.right-160,window.innerWidth-168)),top:rect.bottom+190>window.innerHeight?Math.max(8,rect.top-186):rect.bottom+4})}}><MoreHorizontal size={19}/></button>
 {position&&createPortal(<div ref={panel} role="menu" aria-label={`Actions for ${t.voucher}`} className="transaction-action-menu" style={{left:position.left,top:position.top}} onBlur={e=>{if(e.relatedTarget instanceof Node&&!e.currentTarget.contains(e.relatedTarget)&&e.relatedTarget!==trigger.current)setPosition(null)}} onKeyDown={e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();const buttons=Array.from(panel.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));if(!buttons.length)return;const index=buttons.indexOf(document.activeElement as HTMLButtonElement);const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next].focus()}}>
 <button role="menuitem" disabled={locked||!onEdit} onClick={()=>choose(()=>onEdit?.(t))}>Edit</button>
 <button role="menuitem" title={cloud&&t.migration?"Further migration is unavailable for cloud accounts":undefined} disabled={Boolean((cloud&&t.migration)||t.archivedAt||outgoingMigration(t)||t.reversalOf||t.reconciliation||context.transactions.some(x=>x.reversalOf===t.id))||t.type!=='sale'} onClick={()=>choose(()=>context.start(t))}>Migrate</button>
 {t.type === 'sale' && <button role="menuitem" onClick={()=>choose(()=>context.refund(t))}>Tax Refund</button>}
 <button role="menuitem" className="danger" disabled={Boolean(t.archivedAt||t.migration)||!onArchive} onClick={()=>choose(()=>onArchive?.(t.id))}>Archive</button>
 </div>,document.body)}</>;
}

function TaxRefundForm({source,onClose,onSave}:{source:Transaction;onClose:()=>void;onSave:(refund:Transaction)=>void|Promise<void>}) {
    const editing = isTaxRefund(source);
    const [recordId] = useState(()=>editing ? source.id : id("tax-refund"));
    const [voucher] = useState(()=>editing ? source.voucher : createVoucher("RC",getToday()));
    const [data,setData] = useState({
        amount: editing ? String(source.amount / 100) : "",
        date: editing ? source.date : (getToday() < source.date ? source.date : getToday()),
    });
    const safety = useFormSafety(data,onClose);
    const notify = useContext(ToastContext);
    const submit = async () => {
        if (!safety.start()) return;
        try {
            if (!editing && data.date < source.date) throw Error("Refund date cannot precede the debit entry.");
            const refund: Transaction = editing ? {...source,amount:parseMoney(data.amount),date:data.date} : {
                id:recordId,voucher,type:"payment",agencyId:source.agencyId,
                amount:parseMoney(data.amount),date:data.date,method:"Tax Refund",
                narration:"Tax Return",reference:source.voucher,
                ticket:source.ticket,passenger:source.passenger,
                status:"pending",createdAt:new Date().toISOString(),
            };
            await onSave(refund);
            notify("success",editing ? "Tax refund updated." : "Tax refund added to credit and deducted from profit.");
            onClose();
        } catch (error) {
            safety.fail(error);
            notify("error",error instanceof Error ? error.message : "Unable to save tax refund.");
        } finally { safety.finish(); }
    };
    return <ModalShell title={editing ? "Edit Tax Refund" : "Tax Refund"} subtitle="The refund increases agency credit and reduces profit by the same amount." onClose={safety.close}>
        {safety.error && <p className="form-save-error" role="alert">{safety.error}</p>}
        <div className="form-grid">
            <Field label="Refund amount (BDT)" required><input autoFocus type="number" min="0.01" step="0.01" value={data.amount} onChange={e=>setData({...data,amount:e.target.value})}/></Field>
            <Field label="Posting date" required><input type="date" min={editing ? undefined : source.date} value={data.date} onChange={e=>setData({...data,date:e.target.value})}/></Field>
            <Field label="Narration"><input value="Tax Return" readOnly/></Field>
            <Field label="Ticket / reference"><input value={source.ticket || source.reference || source.voucher} readOnly/></Field>
        </div>
        <FormFooter savingOverride={safety.busy} onClose={safety.close} onSave={submit} offline={!navigator.onLine}/>
    </ModalShell>;
}