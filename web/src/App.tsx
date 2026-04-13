import { useState, useEffect } from "react";
import { fetchJobs, fetchJob, fetchTask, fetchCompare } from "./api";
import type { JobSummary, JobDetail, TaskResult, TaskDetail, CompareResult } from "./types";
import "./style.css";

type Page = "dashboard" | "job" | "compare";
type SortKey = "config" | "agent" | "passed" | "rate" | "errors" | "total" | "started_at";

function fmtTime(ts: string): string {
  try {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ts; }
}

function fmtSize(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}M` : bytes > 1024 ? `${(bytes / 1024).toFixed(0)}K` : `${bytes}B`;
}

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [jobId, setJobId] = useState("");
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [cmpResult, setCmpResult] = useState<CompareResult | null>(null);
  const [cmpFilter, setCmpFilter] = useState<"all" | "diff">("all");
  const [filter, setFilter] = useState<"all" | "pass" | "fail" | "error">("all");
  const [sortKey, setSortKey] = useState<SortKey>("started_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchJobs().then(j => { setJobs(j); setLoading(false); }); }, []);

  const openJob = async (id: string) => {
    setJobId(id); setTask(null); setFilter("all"); setTaskSearch("");
    setJob(await fetchJob(id));
    setPage("job");
  };

  const openTask = async (name: string) => {
    setTaskLoading(true);
    setTask(await fetchTask(jobId, name));
    setTaskLoading(false);
  };

  const toggleCmp = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(compareIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setCompareIds(next);
  };

  const runCompare = async () => {
    setCmpResult(await fetchCompare([...compareIds]));
    setCmpFilter("all");
    setPage("compare");
  };

  // Dashboard sorting
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "config" || key === "agent"); }
  };
  const arrow = (key: SortKey) => sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  const sortedJobs = [...jobs]
    .filter(j => !search || j.config.includes(search) || j.agent.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const va = (a as any)[sortKey], vb = (b as any)[sortKey];
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });

  // Job detail filtering
  const taskFilter = (tasks: TaskResult[]) => {
    let out = tasks;
    if (filter === "pass") out = out.filter(t => t.passed);
    else if (filter === "fail") out = out.filter(t => !t.passed && !t.error_type);
    else if (filter === "error") out = out.filter(t => !!t.error_type);
    if (taskSearch) out = out.filter(t => t.name.includes(taskSearch));
    return out;
  };

  if (loading) return <div className="loading">Loading…</div>;

  // ── Dashboard ──
  if (page === "dashboard") return (
    <div className="app">
      <header>
        <h1>🧪 Agent Eval</h1>
        <div className="header-actions">
          <input className="search" placeholder="Search jobs…" value={search} onChange={e => setSearch(e.target.value)} />
          {compareIds.size >= 2 && <button className="btn-primary" onClick={runCompare}>Compare {compareIds.size} jobs</button>}
          {compareIds.size > 0 && <button className="btn-ghost" onClick={() => setCompareIds(new Set())}>Clear</button>}
        </div>
      </header>
      <div className="stats-bar">
        <span>{sortedJobs.length} jobs</span>
        <span>·</span>
        <span>{sortedJobs.reduce((s, j) => s + j.total, 0)} total tasks</span>
      </div>
      <table className="jobs-table">
        <thead><tr>
          <th style={{width: 32}}></th>
          <th className="sort" onClick={() => toggleSort("config")}>Config{arrow("config")}</th>
          <th className="sort" onClick={() => toggleSort("agent")}>Agent{arrow("agent")}</th>
          <th className="sort r" onClick={() => toggleSort("total")}>Tasks{arrow("total")}</th>
          <th className="sort r" onClick={() => toggleSort("passed")}>Pass{arrow("passed")}</th>
          <th className="sort r" onClick={() => toggleSort("rate")}>Rate{arrow("rate")}</th>
          <th className="sort r" onClick={() => toggleSort("errors")}>Err{arrow("errors")}</th>
          <th className="r">Time</th>
          <th className="sort" onClick={() => toggleSort("started_at")}>Date{arrow("started_at")}</th>
        </tr></thead>
        <tbody>{sortedJobs.map(j => (
          <tr key={j.id} className="row" onClick={() => openJob(j.id)}>
            <td><input type="checkbox" checked={compareIds.has(j.id)} onClick={e => toggleCmp(j.id, e)} readOnly /></td>
            <td className="bold">{j.config}</td>
            <td className="dim">{j.agent || "—"} <span className="muted">/ {j.model || "?"}</span></td>
            <td className="r mono">{j.total}</td>
            <td className="r mono">{j.passed}</td>
            <td className="r"><span className={`pill ${j.rate >= 50 ? "green" : j.rate >= 30 ? "yellow" : "red"}`}>{j.rate}%</span></td>
            <td className="r mono">{j.errors || "—"}</td>
            <td className="r dim">{j.duration || "—"}</td>
            <td className="dim">{fmtTime(j.started_at)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );

  // ── Job Detail ──
  if (page === "job" && job) {
    const tasks = job.tasks;
    const pass = tasks.filter(t => t.passed).length;
    const fail = tasks.filter(t => !t.passed && !t.error_type).length;
    const err = tasks.filter(t => !!t.error_type).length;
    const filtered = taskFilter(tasks);

    return (
      <div className="app">
        <header>
          <div className="breadcrumb">
            <span className="link" onClick={() => { setPage("dashboard"); setTask(null); }}>Jobs</span>
            <span className="sep">/</span>
            <span>{job.config}</span>
          </div>
        </header>

        <div className="job-info">
          <div className="info-grid">
            <div className="info-item"><label>Agent</label><span>{job.agent || "—"}</span></div>
            <div className="info-item"><label>Model</label><span>{job.model || "—"}</span></div>
            <div className="info-item"><label>Date</label><span>{fmtTime(job.started_at)}</span></div>
            <div className="info-item"><label>Rate</label><span className={`pill ${pass/tasks.length >= .5 ? "green" : "yellow"}`}>{(pass/tasks.length*100).toFixed(1)}%</span></div>
          </div>
          <div className="result-bar">
            <div className="bar-pass" style={{width: `${pass/tasks.length*100}%`}}></div>
            <div className="bar-fail" style={{width: `${fail/tasks.length*100}%`}}></div>
            <div className="bar-err" style={{width: `${err/tasks.length*100}%`}}></div>
          </div>
          <div className="result-legend">
            <span className="legend-pass">✓ {pass} pass</span>
            <span className="legend-fail">✗ {fail} fail</span>
            {err > 0 && <span className="legend-err">⚠ {err} error</span>}
          </div>
        </div>

        <div className="job-content">
          <div className={`task-panel ${task ? "narrow" : ""}`}>
            <div className="panel-toolbar">
              <div className="tab-group">
                {(["all", "pass", "fail", "error"] as const).map(f => {
                  const cnt = f === "all" ? tasks.length : f === "pass" ? pass : f === "fail" ? fail : err;
                  return <button key={f} className={`tab ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f} ({cnt})</button>;
                })}
              </div>
              <input className="search small" placeholder="Search task…" value={taskSearch} onChange={e => setTaskSearch(e.target.value)} />
            </div>
            <div className="task-scroll">
              {filtered.map(t => (
                <div key={t.name} className={`task-row ${task?.name === t.name ? "selected" : ""} ${t.passed ? "" : "failed"}`} onClick={() => openTask(t.name)}>
                  <span className={`icon ${t.passed ? "pass" : "fail"}`}>{t.passed ? "✓" : "✗"}</span>
                  <span className="task-name">{t.name}</span>
                  {t.error_type && <span className="err-tag">{t.error_type.replace("Error", "")}</span>}
                  {t.log_size > 0 && <span className="size-tag">{fmtSize(t.log_size)}</span>}
                </div>
              ))}
            </div>
          </div>

          {task && (
            <div className="detail-panel">
              <div className="detail-header">
                <h3>{task.name}</h3>
                <button className="btn-ghost" onClick={() => setTask(null)}>✕</button>
              </div>
              {taskLoading ? <div className="loading">Loading…</div> : (
                <div className="detail-tabs">
                  <TabSection title="📋 Instruction" content={task.instruction} defaultOpen />
                  <TabSection title={`🤖 Agent Log (${fmtSize(task.agent_log.length)})`} content={task.agent_log} />
                  <TabSection title="🧪 Verifier Log" content={task.verifier_log} />
                  <TabSection title="📝 Trial Log" content={task.trial_log} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Compare ──
  if (page === "compare" && cmpResult) {
    const filteredRows = cmpFilter === "diff"
      ? cmpResult.tasks.filter(row => {
          const vals = cmpResult.jobs.map(jid => (row[jid] as any)?.passed);
          return !vals.every(v => v === vals[0]);
        })
      : cmpResult.tasks;

    return (
      <div className="app">
        <header>
          <div className="breadcrumb">
            <span className="link" onClick={() => setPage("dashboard")}>Jobs</span>
            <span className="sep">/</span>
            <span>Compare</span>
          </div>
        </header>
        <div className="cmp-cards">
          {cmpResult.jobs.map(jid => {
            const s = cmpResult.summary[jid];
            const cfg = jid.split("/")[0];
            return (
              <div key={jid} className="cmp-card">
                <div className="cmp-config">{cfg}</div>
                <div className="cmp-score">{s.passed}<span className="cmp-total">/{s.total}</span></div>
                <div className="cmp-rate">{(s.passed / s.total * 100).toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
        <div className="panel-toolbar">
          <div className="tab-group">
            <button className={`tab ${cmpFilter === "all" ? "active" : ""}`} onClick={() => setCmpFilter("all")}>All ({cmpResult.tasks.length})</button>
            <button className={`tab ${cmpFilter === "diff" ? "active" : ""}`} onClick={() => setCmpFilter("diff")}>Differences only</button>
          </div>
        </div>
        <table className="cmp-table">
          <thead><tr>
            <th>Task</th>
            {cmpResult.jobs.map(jid => <th key={jid} className="r">{jid.split("/")[0]}</th>)}
          </tr></thead>
          <tbody>{filteredRows.map(row => {
            const vals = cmpResult.jobs.map(jid => row[jid] as { passed: boolean; error_type?: string } | null);
            const isDiff = !vals.every(v => v?.passed === vals[0]?.passed);
            return (
              <tr key={row.name} className={isDiff ? "diff-row" : ""}>
                <td>{row.name}</td>
                {cmpResult.jobs.map(jid => {
                  const v = row[jid] as { passed: boolean; error_type?: string } | null;
                  if (!v) return <td key={jid} className="r dim">—</td>;
                  return <td key={jid} className={`r ${v.passed ? "cell-pass" : "cell-fail"}`}>{v.passed ? "✓" : "✗"}</td>;
                })}
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    );
  }

  return <div className="app"><div className="loading">Loading…</div></div>;
}

function TabSection({ title, content, defaultOpen }: { title: string; content: string; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen}>
      <summary>{title}</summary>
      <pre className="log-content">{content || "—"}</pre>
    </details>
  );
}
