import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { fmtTime, rateClass } from "../lib/format";
import { AdapterTag } from "../components/AdapterTag";
import { ColumnFilter, ColumnPicker, NumRangeFilter, type NumRange } from "../components/ColumnFilter";
import { useFetch } from "../hooks/useFetch";
import type { JobSummary } from "../types";

// Compact token count: 564, 72k, 15.9M
const fmtTok = (n: number) => !n ? "0" : n < 1000 ? String(n) : n < 1e6 ? `${(n / 1e3).toFixed(0)}k` : `${(n / 1e6).toFixed(1)}M`;
// "1h50m" / "25m" / "45s" -> minutes
const durMin = (s: string) => {
  if (!s) return 0;
  const g = (re: RegExp) => Number((s.match(re) || [0, 0])[1]);
  return g(/(\d+)h/) * 60 + g(/(\d+)m/) + g(/(\d+)s/) / 60;
};
const cost = (j: JobSummary) => j.cost_usd || j.credits * 0.02;
const plainFail = (j: JobSummary) => Math.max(j.failed - j.timeouts - j.errors, 0);
const day = (ts: string) => ts ? new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";

interface Col {
  id: string;
  label: string;
  title?: string;
  center?: boolean;
  filter: "facet" | "range";
  unit?: string;
  value: (j: JobSummary) => string | number;   // used for sort and filter
  render: (j: JobSummary) => ReactNode;
  cls?: string;
}

const text = (k: keyof JobSummary) => (j: JobSummary) => (j[k] as string) || "—";

const COLUMNS: Col[] = [
  { id: "config", label: "Config", filter: "facet", value: text("config"), render: j => j.config, cls: "bold" },
  { id: "agent", label: "Agent", filter: "facet", value: text("agent"), render: j => j.agent || "—", cls: "dim" },
  { id: "model", label: "Model", filter: "facet", value: text("model"), render: j => j.model || "—", cls: "dim mono" },
  { id: "effort", label: "Effort", filter: "facet", value: text("effort"), render: j => j.effort || "—", cls: "dim" },
  { id: "version", label: "Version", title: "Harness version; ~ = inferred from release date", filter: "facet", value: text("version"), render: j => j.version || "—", cls: "dim mono" },
  { id: "adapter", label: "Adapter", filter: "facet", value: text("adapter"), render: j => <AdapterTag adapter={j.adapter} /> },
  { id: "dataset", label: "Dataset", filter: "facet", value: j => j.dataset ? j.dataset.split("/").pop()! : "—", render: j => j.dataset ? j.dataset.split("/").pop() : "—", cls: "dim" },
  { id: "total", label: "Tasks", center: true, filter: "range", value: j => j.total, render: j => j.total, cls: "mono" },
  { id: "passed", label: "Pass", center: true, filter: "range", value: j => j.passed, render: j => j.passed, cls: "mono" },
  { id: "fail", label: "Fail", center: true, filter: "range", value: plainFail, render: j => plainFail(j) || "—", cls: "mono" },
  { id: "timeouts", label: "Timeout", center: true, filter: "range", value: j => j.timeouts, render: j => j.timeouts || "—", cls: "mono" },
  { id: "errors", label: "Error", center: true, filter: "range", value: j => j.errors, render: j => j.errors || "—", cls: "mono" },
  { id: "rate", label: "Rate", center: true, filter: "range", unit: "%", value: j => j.rate, render: j => <span className={`pill ${rateClass(j.rate)}`}>{j.rate}%</span> },
  { id: "task_time", label: "Σ Task", center: true, filter: "range", unit: "min", value: j => Math.round(durMin(j.total_task_time)), render: j => j.total_task_time || "—", cls: "dim" },
  { id: "cost", label: "Cost", center: true, filter: "range", unit: "$", value: cost, render: j => cost(j) ? `$${cost(j).toFixed(2)}` : "—", cls: "dim" },
  { id: "credits", label: "Credits", center: true, filter: "range", value: j => j.credits, render: j => j.credits ? j.credits.toFixed(1) : "—", cls: "dim mono" },
  { id: "tok_in", label: "In tok", title: "Uncached input tokens", center: true, filter: "range", value: j => j.input_tokens, render: j => j.input_tokens || j.output_tokens ? fmtTok(j.input_tokens) : "—", cls: "dim mono" },
  { id: "tok_out", label: "Out tok", center: true, filter: "range", value: j => j.output_tokens, render: j => j.output_tokens ? fmtTok(j.output_tokens) : "—", cls: "dim mono" },
  { id: "tok_cr", label: "Cache R", title: "Cache-read tokens", center: true, filter: "range", value: j => j.cache_read, render: j => j.cache_read ? fmtTok(j.cache_read) : "—", cls: "dim mono" },
  { id: "tok_cw", label: "Cache W", title: "Cache-write tokens", center: true, filter: "range", value: j => j.cache_write, render: j => j.cache_write ? fmtTok(j.cache_write) : "—", cls: "dim mono" },
  { id: "status", label: "Status", center: true, filter: "facet", value: j => j.status,
    render: j => j.status === "running" ? <span className="status-running">● {j.progress}/{j.n_total}</span> : <span className="status-done">✓</span> },
  { id: "date", label: "Date", center: true, filter: "facet", value: j => j.started_at || "", render: j => fmtTime(j.started_at), cls: "dim" },
];

// Facet value shown in the filter list (Date filters by day, not timestamp).
const facetOf = (c: Col, j: JobSummary) => c.id === "date" ? day(j.started_at) : String(c.value(j));

const HIDDEN_KEY = "aae.dashboard.hiddenColumns.v2";
const DEFAULT_HIDDEN = ["tok_cw"];

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data: jobs, loading } = useFetch(() => api.jobs(), []);
  const [sortKey, setSortKey] = useState("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [facets, setFacets] = useState<Record<string, Set<string>>>({});
  const [ranges, setRanges] = useState<Record<string, NumRange>>({});
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try { const v = localStorage.getItem(HIDDEN_KEY); return new Set(v ? JSON.parse(v) : DEFAULT_HIDDEN); }
    catch { return new Set(DEFAULT_HIDDEN); }
  });
  useEffect(() => { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden])); }, [hidden]);

  if (loading || !jobs) return <div className="loading">Loading…</div>;

  const cols = COLUMNS.filter(c => !hidden.has(c.id));
  const facetValues = (c: Col) => {
    const vals = [...new Set(jobs.map(j => facetOf(c, j)))];
    return c.id === "date" ? vals : vals.sort();
  };
  const toggleSort = (c: Col) => {
    if (sortKey === c.id) setSortAsc(!sortAsc);
    else { setSortKey(c.id); setSortAsc(c.filter === "facet" && c.id !== "date"); }
  };
  const arrow = (id: string) => sortKey === id ? (sortAsc ? " ↑" : " ↓") : "";
  const q = search.toLowerCase();
  const sortCol = COLUMNS.find(c => c.id === sortKey) || COLUMNS[0];

  const inRange = (v: number, r?: NumRange) => !r || ((r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max));
  const sorted = [...jobs]
    .filter(j => !q || [j.config, j.agent, j.model, j.effort, j.dataset].some(v => (v || "").toLowerCase().includes(q)))
    .filter(j => COLUMNS.every(c => c.filter === "facet"
      ? !facets[c.id]?.size || facets[c.id].has(facetOf(c, j))
      : inRange(Number(c.value(j)), ranges[c.id])))
    .sort((a, b) => {
      const va = sortCol.value(a), vb = sortCol.value(b);
      return (sortAsc ? 1 : -1) * (va < vb ? -1 : va > vb ? 1 : 0);
    });

  const activeTags: { key: string; label: string; clear: () => void }[] = [];
  for (const c of COLUMNS) {
    for (const v of facets[c.id] || []) activeTags.push({ key: `${c.id}-${v}`, label: `${c.label}: ${v}`, clear: () => { const n = new Set(facets[c.id]); n.delete(v); setFacets({ ...facets, [c.id]: n }); } });
    const r = ranges[c.id];
    if (r && (r.min !== undefined || r.max !== undefined)) {
      const u = c.unit ? ` ${c.unit}` : "";
      const label = r.min !== undefined && r.max !== undefined ? `${r.min}–${r.max}${u}` : r.min !== undefined ? `≥ ${r.min}${u}` : `≤ ${r.max}${u}`;
      activeTags.push({ key: `${c.id}-range`, label: `${c.label} ${label}`, clear: () => { const n = { ...ranges }; delete n[c.id]; setRanges(n); } });
    }
  }

  return (
    <>
      <header>
        <h1 onClick={() => navigate("/")}>🧪 AAE — Agent Auto Eval</h1>
        <div className="header-actions">
          <input className="search" placeholder="Search config / agent / model…" value={search} onChange={e => setSearch(e.target.value)} />
          <ColumnPicker columns={COLUMNS} hidden={hidden} onChange={setHidden} />
          <button className="btn-ghost" onClick={() => navigate("/effort")}>Effort chart</button>
          {selected.size >= 2 && <button className="btn-primary" onClick={() => navigate(`/compare?ids=${[...selected].join(",")}`)}>Compare {selected.size}</button>}
          {selected.size > 0 && <button className="btn-ghost" onClick={() => setSelected(new Set())}>Deselect</button>}
          <a href="https://github.com/vokako/auto-agent-eval" target="_blank" rel="noopener" className="github-link" title="GitHub">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          </a>
        </div>
      </header>
      <div className="stats-bar">
        <span>{sorted.length}/{jobs.length} jobs</span>
        <span>·</span>
        <span>{sorted.reduce((s, j) => s + j.total, 0)} tasks</span>
      </div>
      {activeTags.length > 0 && (
        <div className="active-filters">
          {activeTags.map(t => <span key={t.key} className="filter-tag" onClick={t.clear}>{t.label} ✕</span>)}
          <button className="filter-clear" onClick={() => { setFacets({}); setRanges({}); }}>Clear all</button>
        </div>
      )}
      <table className="jobs-table">
        <thead><tr>
          <th style={{ width: 32 }}></th>
          {cols.map(c => (
            <th key={c.id} className={`sort${c.center ? " c" : ""}`} title={c.title} onClick={() => toggleSort(c)}>
              {c.label}{arrow(c.id)}
              {c.filter === "facet"
                ? <ColumnFilter values={facetValues(c)} selected={facets[c.id] || new Set()} onChange={s => setFacets({ ...facets, [c.id]: s })} />
                : <NumRangeFilter value={ranges[c.id] || {}} unit={c.unit} onChange={r => setRanges({ ...ranges, [c.id]: r })} />}
            </th>
          ))}
        </tr></thead>
        <tbody>{sorted.map(j => (
          <tr key={j.id} className="row" onClick={() => navigate(`/jobs/${j.id}`)}>
            <td><label onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(j.id)} onChange={() => { const n = new Set(selected); n.has(j.id) ? n.delete(j.id) : n.add(j.id); setSelected(n); }} /></label></td>
            {cols.map(c => <td key={c.id} className={`${c.center ? "c " : ""}${c.cls || ""}`}>{c.render(j)}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </>
  );
}
