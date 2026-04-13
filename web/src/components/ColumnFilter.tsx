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
    next.has(val) ? next.delete(val) : next.add(val);
    onChange(next);
  };

  const active = selected.size > 0;

  return (
    <div className="col-filter" ref={ref}>
      <button className={`col-filter-btn ${active ? "active" : ""}`} onClick={e => { e.stopPropagation(); setOpen(!open); }}>▾</button>
      {open && (
        <div className="col-filter-dropdown">
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
