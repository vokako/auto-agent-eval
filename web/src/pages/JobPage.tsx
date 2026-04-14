import { useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { fmtTime, rateClass } from "../lib/format";
import { useFetch } from "../hooks/useFetch";
import { Breadcrumb } from "../components/Breadcrumb";
import { AdapterTag } from "../components/AdapterTag";
import { ResultBar } from "../components/ResultBar";
import { TabSection } from "../components/TabSection";
import { LazyLog } from "../components/LazyLog";
import { FileBrowser } from "../components/FileBrowser";
import type { TaskDetail } from "../types";

type Filter = "all" | "pass" | "fail" | "timeout" | "error";
type DetailTab = "info" | "files";

export default function JobPage() {
  const { config, timestamp } = useParams();
  const jobId = `${config}/${timestamp}`;
  const { data: job, loading } = useFetch(() => api.job(jobId), [jobId]);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [detailTab, setDetailTab] = useState<DetailTab>("info");

  if (loading || !job) return <div className="loading">Loading…</div>;

  const tasks = job.tasks;
  const pass = tasks.filter(t => t.passed).length;
  const fail = tasks.filter(t => !t.passed).length;
  const timeout = tasks.filter(t => t.error_type === "AgentTimeoutError").length;
  const err = tasks.filter(t => t.error_type && t.error_type !== "AgentTimeoutError").length;
  const rate = tasks.length ? pass / tasks.length * 100 : 0;
  const totalTests = tasks.reduce((s, t) => s + t.tests_total, 0);
  const passedTests = tasks.reduce((s, t) => s + t.tests_passed, 0);
  const testRate = totalTests ? passedTests / totalTests * 100 : 0;

  const openTask = async (name: string) => {
    setTaskLoading(true);
    setDetailTab("info");
    setTask(await api.task(jobId, name));
    setTaskLoading(false);
  };

  const filtered = tasks
    .filter(t => {
      if (filter === "pass") return t.passed;
      if (filter === "fail") return !t.passed;
      if (filter === "timeout") return t.error_type === "AgentTimeoutError";
      if (filter === "error") return t.error_type && t.error_type !== "AgentTimeoutError";
      return true;
    })
    .filter(t => !search || t.name.includes(search));

  const filterCounts: Record<Filter, number> = {
    all: tasks.length,
    pass,
    fail,
    timeout,
    error: err,
  };

  return (
    <>
      <header>
        <h1 onClick={() => window.location.href = "/"}>🧪 AAE — Agent Auto Eval</h1>
        <a href="https://github.com/vokako/auto-agent-eval" target="_blank" rel="noopener" className="github-link" title="GitHub">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        </a>
      </header>
      <div className="job-header-card">
        <div className="job-header-top">
          <Breadcrumb items={[{ label: "Jobs", to: "/" }, { label: config! }]} />
          <div className="job-header-meta">
            <span className="dim">{fmtTime(job.started_at)}</span>
            <AdapterTag adapter={job.adapter} version={job.version} />
          </div>
        </div>
        <div className="job-header-main">
          <div className="job-header-left">
            <h2>{job.agent || "—"} <span className="dim">/ {job.model || "?"}</span></h2>
            <span className="dim">{job.dataset || ""}</span>
          </div>
          <div className="job-header-stats">
            <div className="stat-block">
              <div className="stat-value"><span className={`pill ${rateClass(rate)}`}>{rate.toFixed(1)}%</span></div>
              <div className="stat-label">Task Pass <span className="info-sub">{pass}/{tasks.length}</span></div>
            </div>
            <div className="stat-block">
              <div className="stat-value"><span className={`pill ${rateClass(testRate)}`}>{testRate.toFixed(1)}%</span></div>
              <div className="stat-label">Test Pass <span className="info-sub">{passedTests}/{totalTests}</span></div>
            </div>
          </div>
        </div>
        <ResultBar pass={pass} fail={fail - timeout - err} error={err + timeout} />
        <div className="result-legend">
          <span className="legend-pass">Pass {pass}</span>
          <span className="legend-fail">Fail {fail - timeout - err}</span>
          {timeout > 0 && <span className="legend-timeout">Timeout {timeout}</span>}
          {err > 0 && <span className="legend-err">Error {err}</span>}
        </div>
      </div>

      <div className="job-content">
        <div className={`task-panel ${task ? "narrow" : ""}`}>
          <div className="panel-toolbar">
            <div className="tab-group">
              {(["all", "pass", "fail", "timeout", "error"] as const).map(f => (
                filterCounts[f] > 0 || f === "all" ? (
                  <button key={f} className={`tab ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
                    {f} ({filterCounts[f]})
                  </button>
                ) : null
              ))}
            </div>
            <input className="search small" placeholder="Search task…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="task-scroll">
            <table className="task-table">
              <thead><tr>
                <th style={{width:28}}></th>
                <th>Task</th>
                <th className="r">Time</th>
                <th className="r">Tests</th>
                <th className="r">Cost</th>
                <th>Note</th>
              </tr></thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.name} className={`row ${task?.name === t.name ? "selected-row" : ""}`} onClick={() => openTask(t.name)}>
                    <td><span className={`icon ${t.passed ? "pass" : "fail"}`}>{t.passed ? "✓" : "✗"}</span></td>
                    <td className="task-name-cell">{t.name}</td>
                    <td className="r dim mono">{t.duration || "—"}</td>
                    <td className="r mono">
                      {t.tests_total > 0 ? (
                        <span className={t.tests_passed === t.tests_total ? "tc-all-pass" : t.tests_passed > 0 ? "tc-partial" : "tc-none"}>
                          {t.tests_passed}/{t.tests_total}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="r">{t.cost ? <span className="cost-tag">{t.cost}</span> : "—"}</td>
                    <td>
                      {t.error_type === "AgentTimeoutError" && <span className="timeout-tag">Timeout</span>}
                      {t.error_type && t.error_type !== "AgentTimeoutError" && <span className="err-tag">{t.error_type.replace("Error", "")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {task && (
          <div className="detail-panel">
            <div className="detail-header">
              <h3>{task.name}</h3>
              <div>
                <button className={`detail-tab ${detailTab === "info" ? "active" : ""}`} onClick={() => setDetailTab("info")}>Info</button>
                <button className={`detail-tab ${detailTab === "files" ? "active" : ""}`} onClick={() => setDetailTab("files")}>Files</button>
                <button className="btn-ghost" onClick={() => setTask(null)} style={{marginLeft: 8}}>✕</button>
              </div>
            </div>
            {taskLoading ? <div className="loading">Loading…</div> : detailTab === "files" ? (
              <FileBrowser jobId={jobId} taskName={task.name} />
            ) : (
              <div className="detail-tabs">
                {task.test_cases.length > 0 && (
                  <details open>
                    <summary>Tests ({task.test_cases.filter(t => t.status === "passed").length}/{task.test_cases.length} passed)</summary>
                    <div className="test-cases">
                      {task.test_cases.map((tc, i) => (
                        <div key={i} className={`test-case ${tc.status}`}>
                          <span className={`icon ${tc.status === "passed" ? "pass" : "fail"}`}>{tc.status === "passed" ? "✓" : "✗"}</span>
                          <span className="tc-name">{tc.name}</span>
                          {tc.duration > 0 && <span className="tc-dur">{tc.duration}s</span>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                <TabSection title="Instruction" content={task.instruction} defaultOpen={task.test_cases.length === 0} />
                <LazyLog title="Agent Log" jobId={jobId} taskName={task.name} logType="agent" />
                <LazyLog title="Verifier Log" jobId={jobId} taskName={task.name} logType="verifier" />
                <LazyLog title="Trial Log" jobId={jobId} taskName={task.name} logType="trial" />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
