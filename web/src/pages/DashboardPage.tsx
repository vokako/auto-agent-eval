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

  if (loading || !jobs) return <div className="loading">Loading…</div>;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "config" || key === "agent"); }
  };
  const arrow = (key: SortKey) => sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  const sorted = [...jobs]
    .filter(j => !search || j.config.includes(search) || j.agent.toLowerCase().includes(search.toLowerCase()))
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

  const compare = () => {
    navigate(`/compare?ids=${[...selected].join(",")}`);
  };

  return (
    <>
      <header>
        <h1 onClick={() => navigate("/")}>🧪 Agent Eval</h1>
        <div className="header-actions">
          <input className="search" placeholder="Search jobs…" value={search} onChange={e => setSearch(e.target.value)} />
          {selected.size >= 2 && <button className="btn-primary" onClick={compare}>Compare {selected.size} jobs</button>}
          {selected.size > 0 && <button className="btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>}
        </div>
      </header>
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
