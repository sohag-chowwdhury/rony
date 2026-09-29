import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import "./agency-select.css";

type AgencyOption = { id: string; name: string; code: string; active: boolean };

export function AgencySelect({ agencies, value, onChange, label = "Select agency", required = false, className = "" }: {
    label?: string;
    required?: boolean;
    className?: string;
    agencies: AgencyOption[];
    value: string;
    onChange: (id: string) => void;
}) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState<string | null>(null);
    const [active, setActive] = useState(0);
    const selected = agencies.find(agency => agency.id === value);
    const matches = agencies.filter(agency =>
        `${agency.name} ${agency.code}`.toLowerCase().includes((query ?? "").trim().toLowerCase()));
    const activeIndex = Math.min(active, matches.length - 1);
    const close = () => { setOpen(false); setQuery(null); };
    const choose = (index: number) => {
        const agency = matches[index];
        if (!agency) return;
        onChange(agency.id);
        close();
    };
    return <div className={`agency-select ${className}`} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
    }}>
        <label htmlFor={id}>{label}{required && <i aria-hidden="true">*</i>}</label>
        <div className="agency-select-input">
            <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-required={required}
                aria-controls={open ? `${id}-options` : undefined}
                aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
                autoComplete="off" placeholder="Search agency name or code"
                value={open && query !== null ? query : selected ? `${selected.name} · ${selected.code}${!selected.active ? " (Inactive)" : ""}` : ""}
                onFocus={event => { setOpen(true); setActive(0); event.target.select(); }}
                onClick={event => { if (!open) { setOpen(true); setActive(0); event.currentTarget.select(); } }}
                onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }}
                onKeyDown={event => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        setOpen(true);
                        setActive(!open ? 0 : Math.max(0, Math.min(matches.length - 1,
                            activeIndex + (event.key === "ArrowDown" ? 1 : -1))));
                    } else if (event.key === "Enter" && open) {
                        event.preventDefault(); choose(activeIndex);
                    } else if (event.key === "Escape" && open) {
                        event.preventDefault(); event.stopPropagation(); close();
                    }
                }} />
            <ChevronDown size={14} aria-hidden="true" />
        </div>
        {open && <div className="agency-select-menu">
            <div id={`${id}-options`} role="listbox" aria-label="Agencies">
                {matches.map((agency, index) => <div key={agency.id} id={`${id}-option-${index}`}
                    role="option" aria-selected={agency.id === value}
                    className={`${index === activeIndex ? "active" : ""} ${!agency.active ? "inactive" : ""}`}
                    ref={element => { if (index === activeIndex) element?.scrollIntoView({ block: "nearest" }); }}
                    onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
                    {agency.name} · {agency.code}
                    {!agency.active && <span className="agency-option-status">Inactive</span>}
                </div>)}
            </div>
            {!matches.length && <p role="status">No agencies found</p>}
        </div>}
    </div>;
}
