import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { fmtTime, rateClass } from "../lib/format";
import { AdapterTag } from "../components/AdapterTag";
import { useFetch } from "../hooks/useFetch";

type SortKey = "config" | "agent" | "passed" | "rate" | "errors" | "total" | "started_at";

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data: jobs, loading } = useFetch(() => api.jobs(), []);
  const [sortKey, setSortKey] = useState<SortKey>("started_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Column filters
  const [fConfig, setFConfig] = useState<Set<string>>(new Set());
  const [fAgent, setFAgent] = useState<Set<string>>(new Set());
  const [fAdapter, setFAdapter] = useState<Set<string>>(new Set());
  const [fMinTasks, setFMinTasks] = useState(0);
  const [fMinRate, setFMinRate] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  if (loading || !jobs) return <div className="loading">Loading…</div>;

  // Unique values for chip filters
  const configs = [...new Set(jobs.map(j => j.config))].sort();
  const agents = [...new Set(jobs.map(j => j.agent || "—"))].sort();
  const adapters = [...new Set(jobs.map(j => j.adapter))].sort();

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "config" || key === "agent"); }
  };
  const arrow = (key: SortKey) => sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  const toggleChip = (set: Set<string>, setFn: (s: Set<string>) => void, val: string) => {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    setFn(next);
  };

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

  const hasFilters = fConfig.size > 0 || fAgent.size > 0 || fAdapter.size > 0 || fMinTasks > 0 || fMinRate > 0;

  const clearFilters = () => {
    setFConfig(new Set()); setFAgent(new Set()); setFAdapter(new Set());
    setFMinTasks(0); setFMinRate(0);
  };

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
          <button className={`btn-ghost ${showFilters ? "active" : ""}`} onClick={() => setShowFilters(!showFilters)}>
            ⚙ Filters{hasFilters ? ` (${sorted.length}/${jobs.length})` : ""}
          </button>
          {hasFilters && <button className="btn-ghost" onClick={clearFilters}>Clear</button>}
          {selected.size >= 2 && <button className="btn-primary" onClick={() => navigate(`/compare?ids=${[...selected].join(",")}`)}>Compare {selected.size}</button>}
          {selected.size > 0 && <button className="btn-ghost" onClick={() => setSelected(new Set())}>Deselect</button>}
        </div>
      </header>

      {showFilters && (
        <div className="filter-panel">
          <div className="filter-row">
            <label>Config</label>
            <div className="chips">
              {configs.map(c => (
                <button key={c} className={`chip ${fConfig.has(c) ? "active" : ""}`} onClick={() => toggleChip(fConfig, setFConfig, c)}>{c}</button>
              ))}
            </div>
          </div>
          <div className="filter-row">
            <label>Agent</label>
            <div className="chips">
              {agents.map(a => (
                <button key={a} className={`chip ${fAgent.has(a) ? "active" : ""}`} onClick={() => toggleChip(fAgent, setFAgent, a)}>{a}</button>
              ))}
            </div>
          </div>
          <div className="filter-row">
            <label>Adapter</label>
            <div className="chips">
              {adapters.map(a => (
                <button key={a} className={`chip ${fAdapter.has(a) ? "active" : ""}`} onClick={() => toggleChip(fAdapter, setFAdapter, a)}>{a}</button>
              ))}
            </div>
          </div>
          <div className="filter-row">
            <label>Min tasks</label>
            <input type="range" min={0} max={100} value={fMinTasks} onChange={e => setFMinTasks(Number(e.target.value))} />
            <span className="range-val">{fMinTasks}</span>
          </div>
          <div className="filter-row">
            <label>Min rate %</label>
            <input type="range" min={0} max={100} value={fMinRate} onChange={e => setFMinRate(Number(e.target.value))} />
            <span className="range-val">{fMinRate}%</span>
          </div>
        </div>
      )}

      <div className="stats-bar">
        <span>{sorted.length} jobs</span>
        <span>·</span>
        <span>{sorted.reduce((s, j) => s + j.total, 0)} total tasks</span>
      </div>
      <table className="jobs-table">
        <thead><tr>
          <th style={{ width: 32 }}></th>
          <th className="sort" onClick={() => toggleSort("config")}>Config{arrow("config")}</th>
          <th className="sort" onClick={() => toggleSort("agent")}>Agent{arrow("agent")}</th>
          <th>Adapter</th>
          <th className="sort r" onClick={() => toggleSort("total")}>Tasks{arrow("total")}</th>
          <th className="sort r" onClick={() => toggleSort("passed")}>Pass{arrow("passed")}</th>
          <th className="sort r" onClick={() => toggleSort("rate")}>Rate{arrow("rate")}</th>
          <th className="sort r" onClick={() => toggleSort("errors")}>Err{arrow("errors")}</th>
          <th className="r">Time</th>
          <th className="sort" onClick={() => toggleSort("started_at")}>Date{arrow("started_at")}</th>
        </tr></thead>
        <tbody>{sorted.map(j => (
          <tr key={j.id} className="row" onClick={() => navigate(`/jobs/${j.id}`)}>
            <td><input type="checkbox" checked={selected.has(j.id)} onClick={e => toggle(j.id, e)} readOnly /></td>
            <td className="bold">{j.config}</td>
            <td className="dim">{j.agent || "—"} <span className="muted">/ {j.model || "?"}</span></td>
            <td><AdapterTag adapter={j.adapter} version={j.version} /></td>
            <td className="r mono">{j.total}</td>
            <td className="r mono">{j.passed}</td>
            <td className="r"><span className={`pill ${rateClass(j.rate)}`}>{j.rate}%</span></td>
            <td className="r mono">{j.errors || "—"}</td>
            <td className="r dim">{j.duration || "—"}</td>
            <td className="dim">{fmtTime(j.started_at)}</td>
          </tr>
        ))}</tbody>
      </table>
    </>
  );
}
