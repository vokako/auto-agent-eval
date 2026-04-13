import { useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { fmtTime, fmtSize, rateClass } from "../lib/format";
import { useFetch } from "../hooks/useFetch";
import { Breadcrumb } from "../components/Breadcrumb";
import { AdapterTag } from "../components/AdapterTag";
import { ResultBar } from "../components/ResultBar";
import { TabSection } from "../components/TabSection";
import type { TaskDetail } from "../types";

type Filter = "all" | "pass" | "fail" | "error";

export default function JobPage() {
  const { config, timestamp } = useParams();
  const jobId = `${config}/${timestamp}`;
  const { data: job, loading } = useFetch(() => api.job(jobId), [jobId]);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  if (loading || !job) return <div className="loading">Loading…</div>;

  const tasks = job.tasks;
  const pass = tasks.filter(t => t.passed).length;
  const fail = tasks.filter(t => !t.passed).length;
  const err = tasks.filter(t => !!t.error_type).length;
  const rate = tasks.length ? pass / tasks.length * 100 : 0;

  const openTask = async (name: string) => {
    setTaskLoading(true);
    setTask(await api.task(jobId, name));
    setTaskLoading(false);
  };

  const filtered = tasks
    .filter(t => {
      if (filter === "pass") return t.passed;
      if (filter === "fail") return !t.passed;
      if (filter === "error") return !!t.error_type;
      return true;
    })
    .filter(t => !search || t.name.includes(search));

  return (
    <>
      <header>
        <Breadcrumb items={[{ label: "Jobs", to: "/" }, { label: config! }]} />
      </header>

      <div className="job-info">
        <div className="info-grid">
          <div className="info-item"><label>Agent</label><span>{job.agent || "—"}</span></div>
          <div className="info-item"><label>Model</label><span>{job.model || "—"}</span></div>
          <div className="info-item"><label>Adapter</label><AdapterTag adapter={job.adapter} version={job.version} /></div>
          <div className="info-item"><label>Date</label><span>{fmtTime(job.started_at)}</span></div>
          <div className="info-item"><label>Rate</label><span className={`pill ${rateClass(rate)}`}>{rate.toFixed(1)}%</span></div>
        </div>
        <ResultBar pass={pass} fail={fail} error={err} />
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
            <input className="search small" placeholder="Search task…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="task-scroll">
            {filtered.map(t => (
              <div key={t.name} className={`task-row ${task?.name === t.name ? "selected" : ""}`} onClick={() => openTask(t.name)}>
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
    </>
  );
}
