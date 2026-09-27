import { useEffect, useState } from "react";
import { ArrowDownToLine, ChevronDown, Laptop, Monitor, Smartphone } from "lucide-react";
import "./install-guide.css";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let pendingInstallPrompt: InstallPrompt | null = null;
window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); pendingInstallPrompt = event as InstallPrompt; });
window.addEventListener("appinstalled", () => { pendingInstallPrompt = null; });
const guides = [
    { name: "Android", browser: "Google Chrome", icon: Smartphone,
      steps: ["Chrome-এ এই ওয়েবসাইট খুলুন।", "উপরে ⋮ মেনু থেকে Add to Home screen বা Install app চাপুন।", "Install / Add দিয়ে নিশ্চিত করুন। এরপর অ্যাপের আইকন থেকে খুলুন।"],
      href: "https://support.google.com/chrome/answer/9658361?hl=en&co=GENIE.Platform%3DAndroid" },
    { name: "iPhone", browser: "Safari", icon: Smartphone,
      steps: ["Safari-তে এই ওয়েবসাইট খুলুন।", "Share (বাক্সের ওপর তীর) চাপুন, তারপর Add to Home Screen বেছে নিন।", "Open as Web App অপশন থাকলে চালু রাখুন। Add চাপুন—Home Screen-এ আইকন পাবেন।"],
      href: "https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios" },
    { name: "MacBook", browser: "Safari · macOS Sonoma 14+", icon: Laptop,
      steps: ["Safari-তে এই ওয়েবসাইট খুলুন।", "ওপরের File মেনু থেকে Add to Dock বেছে নিন।", "নাম দেখে Add চাপুন। Dock বা Applications থেকে অ্যাপ খুলুন।"],
      note: "পুরোনো macOS-এ Chrome ব্যবহার করুন: ⋮ → Cast, save, and share → Install page as app…",
      href: "https://support.apple.com/en-us/104996" },
    { name: "Windows PC", browser: "Google Chrome / Microsoft Edge", icon: Monitor,
      steps: ["Chrome বা Edge-এ এই ওয়েবসাইট খুলুন।", "Chrome: ⋮ → Cast, save, and share → Install page as app…। Edge: … → More tools → Apps → Install this site as an app।", "Install চাপুন। এরপর অ্যাপের আইকন থেকে খুলুন; চাইলে taskbar-এ pin করুন।"],
      href: "https://support.microsoft.com/en-us/edge/install-manage-or-uninstall-apps-in-microsoft-edge" },
];

export default function InstallGuide() {
    const [prompt, setPrompt] = useState<InstallPrompt | null>(pendingInstallPrompt);
    const [installed, setInstalled] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [status, setStatus] = useState("");
    useEffect(() => {
        const display = window.matchMedia("(display-mode: standalone)");
        const sync = () => setInstalled(display.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
        const available = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
        const complete = () => { setInstalled(true); setPrompt(null); setStatus("অ্যাপ ইনস্টল হয়েছে। এখন অ্যাপের আইকন থেকে খুলতে পারবেন।"); };
        sync();
        display.addEventListener("change", sync);
        window.addEventListener("beforeinstallprompt", available);
        window.addEventListener("appinstalled", complete);
        return () => { display.removeEventListener("change", sync); window.removeEventListener("beforeinstallprompt", available); window.removeEventListener("appinstalled", complete); };
    }, []);
    const install = async () => {
        if (!prompt || installing) return;
        setInstalling(true);
        try {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            setStatus(choice.outcome === "accepted" ? "ইনস্টল অনুরোধ গ্রহণ করা হয়েছে। ডিভাইসে ইনস্টল শেষ হতে দিন।" : "পরে চাইলে ব্রাউজার মেনু থেকে ইনস্টল করতে পারবেন।");
        } catch { setStatus("নিচের নির্দেশনা অনুযায়ী ব্রাউজার মেনু থেকে ইনস্টল করুন।"); }
        finally { pendingInstallPrompt = null; setPrompt(null); setInstalling(false); }
    };
    return <aside className="install-guide" aria-label="অ্যাপ ইনস্টল করার টিউটোরিয়াল" lang="bn">
        <details open>
            <summary>
                <span className="install-guide-symbol"><ArrowDownToLine size={21} aria-hidden="true" /></span>
                <span className="install-guide-title"><strong>হোম স্ক্রিনে অ্যাপ যোগ করুন <span className="install-guide-badge">টিউটোরিয়াল</span></strong><span>Android · iPhone · MacBook · Windows PC</span></span>
                <span className="install-guide-action">যেভাবে করবেন <ChevronDown size={18} aria-hidden="true" /></span>
            </summary>
            <div className="install-guide-body">
                <div className="install-guide-intro"><div><h2>আপনার ডিভাইসে A TO Z AIR TRAVELS</h2><p>এটি একটি Progressive Web App (PWA)। ইনস্টল করলে আইকনে চাপ দিয়েই আলাদা অ্যাপ উইন্ডোতে খুলতে পারবেন।</p></div>
                    {installed ? <span className="install-guide-installed">অ্যাপ ইনস্টল করা আছে</span> : prompt && <button type="button" className="install-guide-button" disabled={installing} onClick={() => void install()}><ArrowDownToLine size={16} aria-hidden="true" />{installing ? "অপেক্ষা করুন…" : "অ্যাপ ইনস্টল করুন"}</button>}
                </div>
                <p className="install-guide-status" role="status">{status}</p>
                <div className="install-guide-grid">{guides.map(guide => <section className="install-guide-card" key={guide.name}>
                    <div className="install-guide-device"><guide.icon size={23} aria-hidden="true" /><div><h3>{guide.name}</h3><span>{guide.browser}</span></div></div>
                    <ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol>
                    {guide.note && <p className="install-guide-note">{guide.note}</p>}
                    <a href={guide.href} target="_blank" rel="noreferrer">অফিশিয়াল নির্দেশনা ↗</a>
                </section>)}</div>
                <p className="install-guide-help">অপশন খুঁজে পাচ্ছেন না? লিংকটি সরাসরি Safari, Chrome বা Edge-এ খুলুন; ব্রাউজারের সংস্করণ অনুযায়ী মেনুর নাম একটু আলাদা হতে পারে। ইনস্টলের পর প্রয়োজন হলে আগের অ্যাকাউন্ট দিয়ে লগইন করুন। ক্লাউড ডেটা দেখা ও পরিবর্তন সেভ করতে ইন্টারনেট লাগবে।</p>
            </div>
        </details>
    </aside>;
}
