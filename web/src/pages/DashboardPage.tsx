import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { fmtTime, rateClass } from "../lib/format";
import { AdapterTag } from "../components/AdapterTag";
import { ColumnFilter, ColumnRangeFilter } from "../components/ColumnFilter";
import { useFetch } from "../hooks/useFetch";
import type { JobSummary } from "../types";

type SortKey = "config" | "agent" | "model" | "effort" | "dataset" | "passed" | "rate" | "errors" | "total" | "cost_usd" | "started_at";
type FacetKey = "config" | "agent" | "model" | "effort" | "adapter" | "dataset";

const FACETS: { key: FacetKey; label: string }[] = [
  { key: "config", label: "Config" }, { key: "agent", label: "Agent" }, { key: "model", label: "Model" },
  { key: "effort", label: "Effort" }, { key: "adapter", label: "Adapter" }, { key: "dataset", label: "Dataset" },
];

const facetVal = (j: JobSummary, k: FacetKey): string => {
  const v = (j as any)[k] as string | undefined;
  if (k === "dataset") return v ? v.split("/").pop()! : "—";
  return v || "—";
};

// Compact token count: 564, 72k, 15.9M
const fmtTok = (n: number) => !n ? "0" : n < 1000 ? String(n) : n < 1e6 ? `${(n / 1e3).toFixed(0)}k` : `${(n / 1e6).toFixed(1)}M`;

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data: jobs, loading } = useFetch(() => api.jobs(), []);
  const [sortKey, setSortKey] = useState<SortKey>("started_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Record<FacetKey, Set<string>>>(
    () => Object.fromEntries(FACETS.map(f => [f.key, new Set<string>()])) as Record<FacetKey, Set<string>>);
  const [fMinTasks, setFMinTasks] = useState(0);
  const [fMinRate, setFMinRate] = useState(0);

  if (loading || !jobs) return <div className="loading">Loading…</div>;

  const values = (k: FacetKey) => [...new Set(jobs.map(j => facetVal(j, k)))].sort();
  const setFacet = (k: FacetKey) => (s: Set<string>) => setFilters({ ...filters, [k]: s });
  const anyFacet = FACETS.some(f => filters[f.key].size > 0);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(["config", "agent", "model", "effort", "dataset"].includes(key)); }
  };
  const arrow = (key: SortKey) => sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";
  const q = search.toLowerCase();

  const sorted = [...jobs]
    .filter(j => !q || [j.config, j.agent, j.model, j.effort].some(v => (v || "").toLowerCase().includes(q)))
    .filter(j => FACETS.every(f => filters[f.key].size === 0 || filters[f.key].has(facetVal(j, f.key))))
    .filter(j => j.total >= fMinTasks)
    .filter(j => j.rate >= fMinRate)
    .sort((a, b) => {
      const va = (a as any)[sortKey] ?? "", vb = (b as any)[sortKey] ?? "";
      return (sortAsc ? 1 : -1) * (va < vb ? -1 : va > vb ? 1 : 0);
    });

  const facetTh = (k: FacetKey, label: string, sortable = true) => (
    <th className={sortable ? "sort" : ""} onClick={sortable ? () => toggleSort(k as SortKey) : undefined}>
      {label}{sortable ? arrow(k as SortKey) : ""}
      <ColumnFilter values={values(k)} selected={filters[k]} onChange={setFacet(k)} />
    </th>
  );

  return (
    <>
      <header>
        <h1 onClick={() => navigate("/")}>🧪 AAE — Agent Auto Eval</h1>
        <div className="header-actions">
          <input className="search" placeholder="Search config / agent / model…" value={search} onChange={e => setSearch(e.target.value)} />
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
      {(anyFacet || fMinTasks > 0 || fMinRate > 0) && (
        <div className="active-filters">
          {FACETS.flatMap(f => [...filters[f.key]].map(v =>
            <span key={`${f.key}-${v}`} className="filter-tag" onClick={() => { const n = new Set(filters[f.key]); n.delete(v); setFacet(f.key)(n); }}>{f.label}: {v} ✕</span>))}
          {fMinTasks > 0 && <span className="filter-tag" onClick={() => setFMinTasks(0)}>Tasks ≥ {fMinTasks} ✕</span>}
          {fMinRate > 0 && <span className="filter-tag" onClick={() => setFMinRate(0)}>Rate ≥ {fMinRate}% ✕</span>}
          <button className="filter-clear" onClick={() => { setFilters(Object.fromEntries(FACETS.map(f => [f.key, new Set<string>()])) as Record<FacetKey, Set<string>>); setFMinTasks(0); setFMinRate(0); }}>Clear all</button>
        </div>
      )}
      <table className="jobs-table">
        <thead><tr>
          <th style={{ width: 32 }}></th>
          {facetTh("config", "Config")}
          {facetTh("agent", "Agent")}
          {facetTh("model", "Model")}
          {facetTh("effort", "Effort")}
          {facetTh("adapter", "Adapter", false)}
          {facetTh("dataset", "Dataset")}
          <th className="sort c" onClick={() => toggleSort("total")}>
            Tasks{arrow("total")}
            <ColumnRangeFilter value={fMinTasks} max={100} onChange={setFMinTasks} />
          </th>
          <th className="sort c" onClick={() => toggleSort("passed")}>Pass{arrow("passed")}</th>
          <th className="c">Fail</th>
          <th className="c">Timeout</th>
          <th className="c">Error</th>
          <th className="sort c" onClick={() => toggleSort("rate")}>
            Rate{arrow("rate")}
            <ColumnRangeFilter value={fMinRate} max={100} onChange={setFMinRate} suffix="%" />
          </th>
          <th className="c">Σ Task</th>
          <th className="sort c" onClick={() => toggleSort("cost_usd")}>Cost{arrow("cost_usd")}</th>
          <th className="c" title="input = uncached input tokens">Tokens in / out / cache R / cache W</th>
          <th className="c">Status</th>
          <th className="sort c" onClick={() => toggleSort("started_at")}>Date{arrow("started_at")}</th>
        </tr></thead>
        <tbody>{sorted.map(j => (
          <tr key={j.id} className="row" onClick={() => navigate(`/jobs/${j.id}`)}>
            <td><label onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(j.id)} onChange={() => { const n = new Set(selected); n.has(j.id) ? n.delete(j.id) : n.add(j.id); setSelected(n); }} /></label></td>
            <td className="bold">{j.config}</td>
            <td className="dim">{j.agent || "—"}</td>
            <td className="dim mono">{j.model || "—"}</td>
            <td className="dim">{j.effort || "—"}</td>
            <td><AdapterTag adapter={j.adapter} version={j.version} /></td>
            <td className="dim">{facetVal(j, "dataset")}</td>
            <td className="c mono">{j.total}</td>
            <td className="c mono">{j.passed}</td>
            <td className="c mono">{j.failed - j.timeouts - j.errors > 0 ? j.failed - j.timeouts - j.errors : "—"}</td>
            <td className="c mono">{j.timeouts || "—"}</td>
            <td className="c mono">{j.errors || "—"}</td>
            <td className="c"><span className={`pill ${rateClass(j.rate)}`}>{j.rate}%</span></td>
            <td className="c dim">{j.total_task_time || "—"}</td>
            <td className="c dim">{j.cost_usd ? `$${j.cost_usd.toFixed(2)}` : j.credits ? `$${(j.credits * 0.02).toFixed(2)}` : "—"}</td>
            <td className="c dim mono">{j.input_tokens || j.output_tokens
              ? `${fmtTok(j.input_tokens)} / ${fmtTok(j.output_tokens)} / ${fmtTok(j.cache_read)} / ${fmtTok(j.cache_write)}`
              : j.credits ? `${j.credits.toFixed(1)} credits` : "—"}</td>
            <td className="c">
              {j.status === "running" ? (
                <span className="status-running">● {j.progress}/{j.n_total}</span>
              ) : (
                <span className="status-done">✓</span>
              )}
            </td>
            <td className="c dim">{fmtTime(j.started_at)}</td>
          </tr>
        ))}</tbody>
      </table>
    </>
  );
}
