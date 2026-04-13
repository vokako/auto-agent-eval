import { useState, useEffect } from "react";
import { fetchJobs, fetchJob, fetchTask, fetchCompare } from "./api";
import type { JobSummary, JobDetail, TaskResult, TaskDetail, CompareResult } from "./types";
import "./style.css";

type Page = "dashboard" | "job" | "compare";

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ts; }
}

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobDetail | null>(null);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [filter, setFilter] = useState<"all" | "pass" | "fail" | "error">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJobs().then((j) => { setJobs(j); setLoading(false); });
  }, []);

  const openJob = async (id: string) => {
    setSelectedJobId(id);
    setSelectedTask(null);
    setFilter("all");
    const detail = await fetchJob(id);
    setSelectedJob(detail);
    setPage("job");
  };

  const openTask = async (taskName: string) => {
    const detail = await fetchTask(selectedJobId, taskName);
    setSelectedTask(detail);
  };

  const toggleCompare = (id: string) => {
    const next = new Set(compareIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setCompareIds(next);
  };

  const runCompare = async () => {
    if (compareIds.size < 2) return;
    const result = await fetchCompare([...compareIds]);
    setCompareResult(result);
    setPage("compare");
  };

  const filteredTasks = (tasks: TaskResult[]) => {
    if (filter === "pass") return tasks.filter(t => t.passed);
    if (filter === "fail") return tasks.filter(t => !t.passed && !t.error_type);
    if (filter === "error") return tasks.filter(t => !!t.error_type);
    return tasks;
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="app">
      <header>
        <h1 onClick={() => { setPage("dashboard"); setSelectedTask(null); }}>🧪 Agent Eval</h1>
        {compareIds.size >= 2 && page === "dashboard" && (
          <button className="btn-compare" onClick={runCompare}>
            Compare ({compareIds.size})
          </button>
        )}
      </header>

      {page === "dashboard" && (
        <div className="dashboard">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Config</th>
                <th>Agent / Model</th>
                <th>Resolved</th>
                <th>Rate</th>
                <th>Errors</th>
                <th>Duration</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => (
                <tr key={j.id} onClick={() => openJob(j.id)} className="clickable">
                  <td>
                    <input
                      type="checkbox"
                      checked={compareIds.has(j.id)}
                      onChange={(e) => { e.stopPropagation(); toggleCompare(j.id); }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="config">{j.config}</td>
                  <td className="agent">{j.agent || "custom"}<span className="model">/{j.model || "?"}</span></td>
                  <td className="num">{j.passed}/{j.total}</td>
                  <td className="num">
                    <span className={`rate ${j.rate >= 50 ? "good" : j.rate >= 30 ? "mid" : "low"}`}>
                      {j.rate}%
                    </span>
                  </td>
                  <td className="num">{j.errors || "—"}</td>
                  <td className="num">{j.duration || "—"}</td>
                  <td className="ts">{formatTime(j.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {page === "job" && selectedJob && (
        <div className="job-detail">
          <div className="job-header">
            <button className="btn-back" onClick={() => { setPage("dashboard"); setSelectedTask(null); }}>← Back</button>
            <h2>{selectedJob.config}</h2>
            <div className="job-meta">
              <span>{formatTime(selectedJob.started_at)}</span>
              <span className="badge pass">{selectedJob.tasks.filter(t => t.passed).length} pass</span>
              <span className="badge fail">{selectedJob.tasks.filter(t => !t.passed).length} fail</span>
              {selectedJob.n_errors > 0 && <span className="badge error">{selectedJob.n_errors} errors</span>}
            </div>
          </div>

          <div className="job-body">
            <div className={`task-list ${selectedTask ? "narrow" : ""}`}>
              <div className="filters">
                {(["all", "pass", "fail", "error"] as const).map(f => (
                  <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                    {f} ({f === "all" ? selectedJob.tasks.length :
                      f === "pass" ? selectedJob.tasks.filter(t => t.passed).length :
                      f === "fail" ? selectedJob.tasks.filter(t => !t.passed && !t.error_type).length :
                      selectedJob.tasks.filter(t => !!t.error_type).length})
                  </button>
                ))}
              </div>
              <table>
                <thead>
                  <tr><th>Task</th><th>Result</th><th>Error</th></tr>
                </thead>
                <tbody>
                  {filteredTasks(selectedJob.tasks).map(t => (
                    <tr
                      key={t.name}
                      onClick={() => openTask(t.name)}
                      className={`clickable ${selectedTask?.name === t.name ? "selected" : ""}`}
                    >
                      <td>{t.name}</td>
                      <td><span className={`dot ${t.passed ? "pass" : "fail"}`}>{t.passed ? "✓" : "✗"}</span></td>
                      <td className="error-type">{t.error_type?.replace("Error", "") || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedTask && (
              <div className="task-detail">
                <div className="task-header">
                  <h3>{selectedTask.name}</h3>
                  <button className="btn-close" onClick={() => setSelectedTask(null)}>✕</button>
                </div>
                <div className="task-sections">
                  <details open>
                    <summary>Instruction</summary>
                    <pre className="log instruction">{selectedTask.instruction || "No instruction found"}</pre>
                  </details>
                  <details>
                    <summary>Agent Log ({(selectedTask.agent_log.length / 1024).toFixed(0)} KB)</summary>
                    <pre className="log agent">{selectedTask.agent_log || "No agent log"}</pre>
                  </details>
                  <details>
                    <summary>Verifier Log</summary>
                    <pre className="log verifier">{selectedTask.verifier_log || "No verifier log"}</pre>
                  </details>
                  <details>
                    <summary>Trial Log</summary>
                    <pre className="log trial">{selectedTask.trial_log || "No trial log"}</pre>
                  </details>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {page === "compare" && compareResult && (
        <div className="compare">
          <button className="btn-back" onClick={() => setPage("dashboard")}>← Back</button>
          <h2>Compare</h2>
          <div className="compare-summary">
            {compareResult.jobs.map(jid => {
              const s = compareResult.summary[jid];
              return (
                <div key={jid} className="compare-card">
                  <div className="compare-name">{jid.split("/")[0]}</div>
                  <div className="compare-rate">{s.passed}/{s.total} ({(s.passed/s.total*100).toFixed(1)}%)</div>
                </div>
              );
            })}
          </div>
          <table>
            <thead>
              <tr>
                <th>Task</th>
                {compareResult.jobs.map(jid => <th key={jid}>{jid.split("/")[0]}</th>)}
              </tr>
            </thead>
            <tbody>
              {compareResult.tasks.map(row => {
                const vals = compareResult.jobs.map(jid => row[jid] as {passed: boolean; error_type?: string} | null);
                const allSame = vals.every(v => v?.passed === vals[0]?.passed);
                return (
                  <tr key={row.name} className={allSame ? "" : "diff"}>
                    <td>{row.name}</td>
                    {compareResult.jobs.map(jid => {
                      const v = row[jid] as {passed: boolean; error_type?: string} | null;
                      if (!v) return <td key={jid} className="na">—</td>;
                      return (
                        <td key={jid} className={v.passed ? "cell-pass" : "cell-fail"}>
                          {v.passed ? "✓" : "✗"}{v.error_type ? ` ${v.error_type.replace("Error","")}` : ""}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
