import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { fmtTime, rateClass } from "../lib/format";
import { AdapterTag } from "../components/AdapterTag";
import { ColumnFilter, ColumnRangeFilter } from "../components/ColumnFilter";
import { useFetch } from "../hooks/useFetch";

type SortKey = "config" | "agent" | "passed" | "rate" | "errors" | "total" | "started_at";

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data: jobs, loading } = useFetch(() => api.jobs(), []);
  const [sortKey, setSortKey] = useState<SortKey>("started_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [fConfig, setFConfig] = useState<Set<string>>(new Set());
  const [fAgent, setFAgent] = useState<Set<string>>(new Set());
  const [fAdapter, setFAdapter] = useState<Set<string>>(new Set());
  const [fMinTasks, setFMinTasks] = useState(0);
  const [fMinRate, setFMinRate] = useState(0);

  if (loading || !jobs) return <div className="loading">Loading…</div>;

  const configs = [...new Set(jobs.map(j => j.config))].sort();
  const agents = [...new Set(jobs.map(j => j.agent || "—"))].sort();
  const adapters = [...new Set(jobs.map(j => j.adapter))].sort();

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "config" || key === "agent"); }
  };
  const arrow = (key: SortKey) => sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  const sorted = [...jobs]
    .filter(j => !search || j.config.includes(search) || j.agent.toLowerCase().includes(search.toLowerCase()))
    .filter(j => fConfig.size === 0 || fConfig.has(j.config))
    .filter(j => fAgent.size === 0 || fAgent.has(j.agent || "—"))
    .filter(j => fAdapter.size === 0 || fAdapter.has(j.adapter))
    .filter(j => j.total >= fMinTasks)
    .filter(j => j.rate >= fMinRate)
    .sort((a, b) => {
      const va = (a as any)[sortKey], vb = (b as any)[sortKey];
      return (sortAsc ? 1 : -1) * (va < vb ? -1 : va > vb ? 1 : 0);
    });

  const toggle = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  return (
    <>
      <header>
        <h1 onClick={() => navigate("/")}>🧪 Agent Eval</h1>
        <div className="header-actions">
          <input className="search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
          {selected.size >= 2 && <button className="btn-primary" onClick={() => navigate(`/compare?ids=${[...selected].join(",")}`)}>Compare {selected.size}</button>}
          {selected.size > 0 && <button className="btn-ghost" onClick={() => setSelected(new Set())}>Deselect</button>}
        </div>
      </header>
      <div className="stats-bar">
        <span>{sorted.length}/{jobs.length} jobs</span>
        <span>·</span>
        <span>{sorted.reduce((s, j) => s + j.total, 0)} tasks</span>
      </div>
      {(fConfig.size > 0 || fAgent.size > 0 || fAdapter.size > 0 || fMinTasks > 0 || fMinRate > 0) && (
        <div className="active-filters">
          {[...fConfig].map(v => <span key={`c-${v}`} className="filter-tag" onClick={() => { const n = new Set(fConfig); n.delete(v); setFConfig(n); }}>Config: {v} ✕</span>)}
          {[...fAgent].map(v => <span key={`a-${v}`} className="filter-tag" onClick={() => { const n = new Set(fAgent); n.delete(v); setFAgent(n); }}>Agent: {v} ✕</span>)}
          {[...fAdapter].map(v => <span key={`d-${v}`} className="filter-tag" onClick={() => { const n = new Set(fAdapter); n.delete(v); setFAdapter(n); }}>Adapter: {v} ✕</span>)}
          {fMinTasks > 0 && <span className="filter-tag" onClick={() => setFMinTasks(0)}>Tasks ≥ {fMinTasks} ✕</span>}
          {fMinRate > 0 && <span className="filter-tag" onClick={() => setFMinRate(0)}>Rate ≥ {fMinRate}% ✕</span>}
          <button className="filter-clear" onClick={() => { setFConfig(new Set()); setFAgent(new Set()); setFAdapter(new Set()); setFMinTasks(0); setFMinRate(0); }}>Clear all</button>
        </div>
      )}
      <table className="jobs-table">
        <thead><tr>
          <th style={{ width: 32 }}></th>
          <th className="sort" onClick={() => toggleSort("config")}>
            Config{arrow("config")}
            <ColumnFilter values={configs} selected={fConfig} onChange={setFConfig} />
          </th>
          <th className="sort" onClick={() => toggleSort("agent")}>
            Agent{arrow("agent")}
            <ColumnFilter values={agents} selected={fAgent} onChange={setFAgent} />
          </th>
          <th>
            Adapter
            <ColumnFilter values={adapters} selected={fAdapter} onChange={setFAdapter} />
          </th>
          <th>Dataset</th>
          <th className="sort r" onClick={() => toggleSort("total")}>
            Tasks{arrow("total")}
            <ColumnRangeFilter value={fMinTasks} max={100} onChange={setFMinTasks} />
          </th>
          <th className="sort r" onClick={() => toggleSort("passed")}>Pass{arrow("passed")}</th>
          <th className="sort r" onClick={() => toggleSort("rate")}>
            Rate{arrow("rate")}
            <ColumnRangeFilter value={fMinRate} max={100} onChange={setFMinRate} suffix="%" />
          </th>
          <th className="sort r" onClick={() => toggleSort("errors")}>Err{arrow("errors")}</th>
          <th className="r">Wall</th>
          <th className="r">Σ Task</th>
          <th>Status</th>
          <th className="sort" onClick={() => toggleSort("started_at")}>Date{arrow("started_at")}</th>
        </tr></thead>
        <tbody>{sorted.map(j => (
          <tr key={j.id} className="row" onClick={() => navigate(`/jobs/${j.id}`)}>
            <td><input type="checkbox" checked={selected.has(j.id)} onClick={e => toggle(j.id, e)} readOnly /></td>
            <td className="bold">{j.config}</td>
            <td className="dim">{j.agent || "—"} <span className="muted">/ {j.model || "?"}</span></td>
            <td><AdapterTag adapter={j.adapter} version={j.version} /></td>
            <td className="dim">{j.dataset ? j.dataset.split("/").pop() : "—"}</td>
            <td className="r mono">{j.total}</td>
            <td className="r mono">{j.passed}</td>
            <td className="r"><span className={`pill ${rateClass(j.rate)}`}>{j.rate}%</span></td>
            <td className="r mono">{j.errors || "—"}</td>
            <td className="r dim">{j.duration || "—"}</td>
            <td className="r dim">{j.total_task_time || "—"}</td>
            <td>
              {j.status === "running" ? (
                <span className="status-running">● {j.progress}/{j.n_total}</span>
              ) : (
                <span className="status-done">✓</span>
              )}
            </td>
            <td className="dim">{fmtTime(j.started_at)}</td>
          </tr>
        ))}</tbody>
      </table>
    </>
  );
}
