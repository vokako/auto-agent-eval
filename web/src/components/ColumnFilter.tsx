import { useState, useRef, useEffect } from "react";

interface Props {
  values: string[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}

export function ColumnFilter({ values, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (val: string) => {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val); else next.add(val);
    onChange(next);
  };

  const active = selected.size > 0;

  return (
    <div className="col-filter" ref={ref}>
      <button className={`col-filter-btn ${active ? "active" : ""}`} onClick={e => { e.stopPropagation(); setOpen(!open); }}>▾</button>
      {open && (
        <div className="col-filter-dropdown" onClick={e => e.stopPropagation()}>
          <div className="col-filter-actions">
            <button onClick={() => onChange(new Set())}>Clear</button>
            <button onClick={() => onChange(new Set(values))}>All</button>
          </div>
          <div className="col-filter-list">
            {values.map(v => (
              <label key={v} className="col-filter-item">
                <input type="checkbox" checked={selected.has(v)} onChange={() => toggle(v)} />
                <span>{v}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface RangeProps {
  value: number;
  max: number;
  onChange: (n: number) => void;
  suffix?: string;
}

export function ColumnRangeFilter({ value, max, onChange, suffix }: RangeProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const active = value > 0;

  return (
    <div className="col-filter" ref={ref}>
      <button className={`col-filter-btn ${active ? "active" : ""}`} onClick={e => { e.stopPropagation(); setOpen(!open); }}>▾</button>
      {open && (
        <div className="col-filter-dropdown range">
          <div className="col-filter-range">
            <span>≥ {value}{suffix}</span>
            <input type="range" min={0} max={max} value={value} onChange={e => onChange(Number(e.target.value))} />
            {active && <button onClick={() => onChange(0)}>Clear</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// Min / max numeric filter. Empty input = no bound.
export interface NumRange { min?: number; max?: number }

export function NumRangeFilter({ value, onChange, unit }: { value: NumRange; onChange: (r: NumRange) => void; unit?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  const active = value.min !== undefined || value.max !== undefined;
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  return (
    <div className="col-filter" ref={ref}>
      <button className={`col-filter-btn ${active ? "active" : ""}`} onClick={e => { e.stopPropagation(); setOpen(!open); }}>▾</button>
      {open && (
        <div className="col-filter-dropdown range" onClick={e => e.stopPropagation()}>
          <div className="col-filter-minmax">
            <input type="number" placeholder="min" value={value.min ?? ""} onChange={e => onChange({ ...value, min: num(e.target.value) })} />
            <span>–</span>
            <input type="number" placeholder="max" value={value.max ?? ""} onChange={e => onChange({ ...value, max: num(e.target.value) })} />
            {unit && <span className="muted">{unit}</span>}
          </div>
          {active && <div className="col-filter-actions" style={{ border: 0, margin: "6px 0 0", padding: 0 }}><button onClick={() => onChange({})}>Clear</button></div>}
        </div>
      )}
    </div>
  );
}

// "Columns" menu: toggle which columns are shown.
export function ColumnPicker({ columns, hidden, onChange }: { columns: { id: string; label: string }[]; hidden: Set<string>; onChange: (h: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  const toggle = (id: string) => { const n = new Set(hidden); if (n.has(id)) n.delete(id); else n.add(id); onChange(n); };
  return (
    <div className="col-filter col-picker" ref={ref}>
      <button className="btn-ghost" onClick={() => setOpen(!open)}>Columns{hidden.size ? ` (${columns.length - hidden.size}/${columns.length})` : ""} ▾</button>
      {open && (
        <div className="col-filter-dropdown" style={{ left: "auto", right: 0 }}>
          <div className="col-filter-actions">
            <button onClick={() => onChange(new Set())}>Show all</button>
          </div>
          <div className="col-filter-list" style={{ maxHeight: 360 }}>
            {columns.map(c => (
              <label key={c.id} className="col-filter-item">
                <input type="checkbox" checked={!hidden.has(c.id)} onChange={() => toggle(c.id)} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
