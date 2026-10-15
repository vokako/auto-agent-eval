import { useEffect, useState, type ReactNode } from "react";
import { AppHeader } from "../components/AppHeader";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { fmtTime, rateClass } from "../lib/format";
import { AdapterTag } from "../components/AdapterTag";
import { ColumnFilter, ColumnPicker, NumRangeFilter, type NumRange } from "../components/ColumnFilter";
import { useFetch } from "../hooks/useFetch";
import { usePersisted, setMapCodec } from "../hooks/usePersisted";
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
const avgMin = (j: JobSummary) => j.agent_s && j.total ? j.agent_s / 60 / j.total : 0;
const shortModel = (m: string) => m.replace(/^(global|us|eu|apac)\./, "").replace(/^(anthropic|openai)\./, "");
const plainFail = (j: JobSummary) => Math.max(j.failed - j.timeouts - j.errors - (j.refused || 0), 0);
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
  { id: "config", label: "Config", filter: "facet", value: text("config"), render: j => j.config, cls: "bold nowrap" },
  { id: "agent", label: "Agent", filter: "facet", value: text("agent"), render: j => j.agent || "—", cls: "dim" },
  { id: "model", label: "Model", filter: "facet", value: text("model"), render: j => j.model ? <span title={j.model}>{shortModel(j.model)}</span> : "—", cls: "dim mono nowrap" },
  { id: "effort", label: "Effort", filter: "facet", value: text("effort"), render: j => j.effort || "—", cls: "dim" },
  { id: "variant", label: "Variant", title: "Prompt / steering variant (empty = harness default)", filter: "facet", value: j => j.variant || "—", render: j => j.variant || "—", cls: "dim" },
  { id: "version", label: "Version", title: "Harness (agent CLI) version", filter: "facet", value: text("version"), render: j => j.version || "—", cls: "dim mono" },
  { id: "adapter", label: "Adapter", filter: "facet", value: text("adapter"), render: j => <AdapterTag adapter={j.adapter} /> },
  { id: "dataset", label: "Dataset", filter: "facet", value: j => j.dataset ? j.dataset.split("/").pop()! : "—", render: j => j.dataset ? j.dataset.split("/").pop() : "—", cls: "dim nowrap" },
  { id: "total", label: "Tasks", center: true, filter: "range", value: j => j.total, render: j => j.total, cls: "mono" },
  { id: "passed", label: "Pass", center: true, filter: "range", value: j => j.passed, render: j => j.passed, cls: "mono" },
  { id: "fail", label: "Fail", center: true, filter: "range", value: plainFail, render: j => plainFail(j) || "—", cls: "mono" },
  { id: "timeouts", label: "Timeout", center: true, filter: "range", value: j => j.timeouts, render: j => j.timeouts || "—", cls: "mono" },
  { id: "refused", label: "Refused", title: "Model safety refusals (not counted as Fail)", center: true, filter: "range", value: j => j.refused || 0, render: j => j.refused || "—", cls: "mono" },
  { id: "not_run", label: "Not run", title: "Quota exhausted before any model call (excluded from Tasks and the pass rate)", center: true, filter: "range", value: j => j.not_run || 0, render: j => j.not_run || "—", cls: "mono" },
  { id: "errors", label: "Error", center: true, filter: "range", value: j => j.errors, render: j => j.errors || "—", cls: "mono" },
  { id: "rate", label: "Rate", center: true, filter: "range", unit: "%", value: j => j.rate, render: j => <span className={`pill ${rateClass(j.rate)}`}>{j.rate}%</span> },
  { id: "task_time", label: "Σ Task", center: true, filter: "range", unit: "min", value: j => Math.round(durMin(j.total_task_time)), render: j => j.total_task_time || "—", cls: "dim" },
  { id: "avg_task", label: "Avg/task", title: "Average agent time per task (minutes, excludes grading)", center: true, filter: "range", unit: "min",
    value: avgMin, render: j => avgMin(j) ? `${avgMin(j).toFixed(1)}m` : "—", cls: "dim mono" },
  { id: "cost", label: "Cost", center: true, filter: "range", unit: "$", value: cost, render: j => cost(j) ? <>{`$${cost(j).toFixed(2)}`}{j.usage_missing ? <span className="warn-mark" title={`${j.usage_missing} trial(s) recorded no usage; their cost is not included`}> *</span> : null}</> : "—", cls: "dim nowrap" },
  { id: "credits", label: "Credits", center: true, filter: "range", value: j => j.credits, render: j => j.credits ? j.credits.toFixed(1) : "—", cls: "dim mono" },
  { id: "tok_in", label: "In tok", title: "Uncached input tokens", center: true, filter: "range", value: j => j.input_tokens, render: j => j.input_tokens || j.output_tokens ? fmtTok(j.input_tokens) : "—", cls: "dim mono" },
  { id: "tok_out", label: "Out tok", center: true, filter: "range", value: j => j.output_tokens, render: j => j.output_tokens ? fmtTok(j.output_tokens) : "—", cls: "dim mono" },
  { id: "tok_cr", label: "Cache R", title: "Cache-read tokens", center: true, filter: "range", value: j => j.cache_read, render: j => j.cache_read ? fmtTok(j.cache_read) : "—", cls: "dim mono" },
  { id: "tok_cw", label: "Cache W", title: "Cache-write tokens", center: true, filter: "range", value: j => j.cache_write, render: j => j.cache_write ? fmtTok(j.cache_write) : "—", cls: "dim mono" },
  { id: "status", label: "Status", center: true, filter: "facet", value: j => j.status,
    render: j => j.status === "running" ? <span className="status-running">● {j.progress}/{j.n_total}</span> : <span className="status-done">✓</span> },
  { id: "date", label: "Date", center: true, filter: "facet", value: j => j.started_at || "", render: j => fmtTime(j.started_at), cls: "dim nowrap" },
];

// Facet value shown in the filter list (Date filters by day, not timestamp).
const facetOf = (c: Col, j: JobSummary) => c.id === "date" ? day(j.started_at) : String(c.value(j));

const HIDDEN_KEY = "aae.dashboard.hiddenColumns.v2";
const DEFAULT_HIDDEN = ["tok_cw"];

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data: jobs, loading } = useFetch(() => api.jobs(), []);
  const [sortKey, setSortKey] = usePersisted("aae.dashboard.sortKey", "date");
  const [sortAsc, setSortAsc] = usePersisted("aae.dashboard.sortAsc", false);
  const [search, setSearch] = usePersisted("aae.dashboard.search", "");
  const [selected, setSelected] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem("aae.dashboard.selected") || "[]")); } catch { return new Set(); }
  });
  useEffect(() => { sessionStorage.setItem("aae.dashboard.selected", JSON.stringify([...selected])); }, [selected]);
  const [facets, setFacets] = usePersisted<Record<string, Set<string>>, Record<string, string[]>>("aae.dashboard.facets", {}, setMapCodec.encode, setMapCodec.decode);
  const [ranges, setRanges] = usePersisted<Record<string, NumRange>>("aae.dashboard.ranges", {});
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
      <AppHeader>
        <input className="search" placeholder="Search config / agent / model…" value={search} onChange={e => setSearch(e.target.value)} />
          <ColumnPicker columns={COLUMNS} hidden={hidden} onChange={setHidden} />
          <button className={selected.size ? "btn-primary" : "btn-ghost"} disabled={!selected.size}
            title={selected.size ? "Plot the selected jobs" : "Tick jobs in the table first"}
            onClick={() => navigate(`/effort?ids=${encodeURIComponent([...selected].join(","))}`)}>
            Chart{selected.size ? ` ${selected.size}` : ""}
          </button>
          {selected.size >= 2 && <button className="btn-primary" onClick={() => navigate(`/compare?ids=${[...selected].join(",")}`)}>Compare {selected.size}</button>}
          {selected.size > 0 && <button className="btn-ghost" onClick={() => setSelected(new Set())}>Deselect</button>}
      </AppHeader>
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
          <th style={{ width: 32 }}>
            <input type="checkbox" title="Select all visible rows"
              checked={sorted.length > 0 && sorted.every(j => selected.has(j.id))}
              onChange={e => { const n = new Set(selected); sorted.forEach(j => e.target.checked ? n.add(j.id) : n.delete(j.id)); setSelected(n); }} />
          </th>
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
            <td><label onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(j.id)} onChange={() => { const n = new Set(selected); if (n.has(j.id)) n.delete(j.id); else n.add(j.id); setSelected(n); }} /></label></td>
            {cols.map(c => <td key={c.id} className={`${c.center ? "c " : ""}${c.cls || ""}`}>{c.render(j)}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </>
  );
}
