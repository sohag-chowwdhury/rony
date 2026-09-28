import { useId, useState } from "react";
import { airlines } from "./airlines";
import "./airline-select.css";

export function AirlineSelect({ value, onChange }: { value: string; onChange: (code: string, name: string) => void }) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const selected = airlines.find(([code]) => code === value);
    const matches = airlines.filter(([code, name]) => code === "OTHER" || `${code} ${name}`.toLowerCase().includes(query.trim().toLowerCase()));
    const choose = (index: number) => {
        const [code, name] = matches[index];
        onChange(code, code === "OTHER" ? "" : name);
        setOpen(false);
        setQuery("");
    };
    return <div className="field airline-select" onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(""); }
    }}>
        <label htmlFor={id}>Airline</label>
        <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open}
            aria-controls={`${id}-options`} aria-activedescendant={open ? `${id}-option-${active}` : undefined}
            autoComplete="off" placeholder="Search airline code or name"
            value={open ? query : selected ? `${selected[0]} - ${selected[1]}` : ""}
            onFocus={() => { setOpen(true); setActive(0); }}
            onClick={() => { setOpen(true); setActive(0); }}
            onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
            onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setOpen(true);
                    setActive(index => !open ? 0 : Math.max(0, Math.min(matches.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
                } else if (event.key === "Enter" && open) {
                    event.preventDefault(); choose(active);
                } else if (event.key === "Escape") {
                    event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery("");
                }
            }} />
        {open && <div className="airline-options" id={`${id}-options`} role="listbox" aria-label="Airlines">
            {matches.map(([code, name], index) => <div key={code} id={`${id}-option-${index}`}
                role="option" aria-selected={code === value} className={index === active ? "active" : ""}
                ref={element => { if (index === active) element?.scrollIntoView({ block: "nearest" }); }}
                onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
                {code} - {name}
            </div>)}
        </div>}
    </div>;
}