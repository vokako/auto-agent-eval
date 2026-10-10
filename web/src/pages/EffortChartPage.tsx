import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type EffortSeries } from "../lib/api";
import { useFetch } from "../hooks/useFetch";

// One colour per agent (harness); models of the same agent share it and differ by dash pattern.
const AGENT_COLORS: Record<string, string> = {
  "claude-code": "#f59e0b", "codex": "#34d399", "kiro-cli": "#a78bfa",
};
const FALLBACK = ["#60a5fa", "#f87171", "#fbbf24", "#22d3ee"];
const DASHES = ["", "6 4", "2 4", "10 4 2 4", "1 3", "12 6"];
const MARKERS = ["circle", "square", "triangle", "diamond", "cross", "circle"] as const;

type Metric = "cost_usd" | "passed" | "agent_s";
const METRICS: { key: Metric; label: string; fmt: (v: number) => string }[] = [
  { key: "cost_usd", label: "Total cost (USD)", fmt: v => `$${v.toFixed(2)}` },
  { key: "passed", label: "Passed tasks", fmt: v => String(v) },
  { key: "agent_s", label: "Total agent time (min)", fmt: v => `${(v / 60).toFixed(0)}m` },
];

const shortModel = (m: string) => m.replace(/^(global|us)\./, "").replace(/^(anthropic|openai)\./, "");

function Marker({ kind, x, y, color }: { kind: typeof MARKERS[number]; x: number; y: number; color: string }) {
  const r = 4.5;
  if (kind === "square") return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} fill={color} />;
  if (kind === "triangle") return <polygon points={`${x},${y - r - 1} ${x - r - 1},${y + r} ${x + r + 1},${y + r}`} fill={color} />;
  if (kind === "diamond") return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`} fill={color} />;
  if (kind === "cross") return <g stroke={color} strokeWidth={2.5}><line x1={x - r} y1={y - r} x2={x + r} y2={y + r} /><line x1={x - r} y1={y + r} x2={x + r} y2={y - r} /></g>;
  return <circle cx={x} cy={y} r={r} fill={color} />;
}

export default function EffortChartPage() {
  const navigate = useNavigate();
  const { data, loading } = useFetch(() => api.effortCurves(), []);
  const [subset, setSubset] = useState<string>("");
  const [metric, setMetric] = useState<Metric>("cost_usd");
  const [logY, setLogY] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<{ x: number; y: number; text: string[] } | null>(null);

  const subsets = useMemo(() => [...new Set((data?.series || []).map(s => s.subset))].sort(), [data]);
  const cur = subset || subsets[0] || "";

  if (loading || !data) return <div className="loading">Loading…</div>;

  const all = data.series.filter(s => s.subset === cur);
  const agents = [...new Set(all.map(s => s.agent))].sort();
  const colorOf = (a: string) => AGENT_COLORS[a] || FALLBACK[agents.indexOf(a) % FALLBACK.length];
  const styleIdx = new Map<string, number>();
  for (const a of agents) all.filter(s => s.agent === a).forEach((s, i) => styleIdx.set(`${s.agent}|${s.model}`, i));
  const sid = (s: EffortSeries) => `${s.agent}|${s.model}`;
  const shown = all.filter(s => !hidden.has(sid(s)));

  const efforts = data.efforts.filter(e => all.some(s => s.points.some(p => p.effort === e)));
  const m = METRICS.find(x => x.key === metric)!;
  const vals = shown.flatMap(s => s.points.map(p => p[metric])).filter(v => v > 0);
  const useLog = logY && metric !== "passed" && vals.length > 0;
  const tasksMax = Math.max(1, ...all.flatMap(s => s.points.map(p => p.tasks)));
  let lo = metric === "passed" ? 0 : Math.min(...vals, 1), hi = metric === "passed" ? tasksMax : Math.max(...vals, 1);
  if (useLog) { lo = Math.pow(10, Math.floor(Math.log10(lo))); hi = Math.pow(10, Math.ceil(Math.log10(hi))); }
  else if (metric !== "passed") { lo = 0; hi = hi * 1.1; }

  const W = 980, H = 520, L = 72, R = 24, T = 24, B = 48;
  const xOf = (e: string) => efforts.length <= 1 ? (L + W - R) / 2 : L + (efforts.indexOf(e) / (efforts.length - 1)) * (W - L - R);
  const yOf = (v: number) => {
    const f = useLog ? (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) : (v - lo) / (hi - lo || 1);
    return H - B - f * (H - T - B);
  };
  const ticks: number[] = [];
  if (useLog) for (let d = lo; d <= hi * 1.0001; d *= 10) { ticks.push(d); if (d * 2 < hi) ticks.push(d * 2); if (d * 5 < hi) ticks.push(d * 5); }
  else for (let i = 0; i <= 5; i++) ticks.push(lo + (hi - lo) * i / 5);

  const toggle = (k: string) => { const n = new Set(hidden); n.has(k) ? n.delete(k) : n.add(k); setHidden(n); };

  return (
    <>
      <header>
        <h1 onClick={() => navigate("/")}>🧪 AAE — Agent Auto Eval</h1>
        <div className="header-actions">
          <button className="btn-ghost" onClick={() => navigate("/")}>← Jobs</button>
        </div>
      </header>
      <div className="chart-controls">
        <label>Task set
          <select value={cur} onChange={e => setSubset(e.target.value)}>
            {subsets.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>Y axis
          <select value={metric} onChange={e => setMetric(e.target.value as Metric)}>
            {METRICS.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
        {metric !== "passed" && <label className="chk"><input type="checkbox" checked={logY} onChange={e => setLogY(e.target.checked)} /> log scale</label>}
        <span className="muted">Kiro credits priced at $0.02/credit</span>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="effort-chart" onMouseLeave={() => setHover(null)}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={yOf(t)} y2={yOf(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={L - 8} y={yOf(t) + 4} textAnchor="end" fill="var(--dim)" fontSize={11}>{m.fmt(t)}</text>
            </g>
          ))}
          {efforts.map(e => (
            <g key={e}>
              <line x1={xOf(e)} x2={xOf(e)} y1={T} y2={H - B} stroke="var(--border)" strokeDasharray="2 4" />
              <text x={xOf(e)} y={H - B + 20} textAnchor="middle" fill="var(--text)" fontSize={12}>{e}</text>
            </g>
          ))}
          <text x={(L + W - R) / 2} y={H - 8} textAnchor="middle" fill="var(--dim)" fontSize={12}>effort</text>
          <text x={16} y={(T + H - B) / 2} textAnchor="middle" fill="var(--dim)" fontSize={12} transform={`rotate(-90 16 ${(T + H - B) / 2})`}>{m.label}</text>
          {shown.map(s => {
            const c = colorOf(s.agent), i = styleIdx.get(sid(s)) || 0;
            const pts = s.points.filter(p => efforts.includes(p.effort));
            return (
              <g key={sid(s)}>
                <polyline fill="none" stroke={c} strokeWidth={2} strokeDasharray={DASHES[i % DASHES.length]}
                  points={pts.map(p => `${xOf(p.effort)},${yOf(p[metric])}`).join(" ")} />
                {pts.map(p => (
                  <g key={p.effort} style={{ cursor: "pointer" }}
                    onMouseEnter={() => setHover({ x: xOf(p.effort), y: yOf(p[metric]), text: [
                      `${s.agent} · ${shortModel(s.model)} · ${p.effort}`,
                      `passed ${p.passed}/${p.tasks}`,
                      `cost $${p.cost_usd.toFixed(2)}${p.credits ? ` (${p.credits.toFixed(1)} credits)` : ""}`,
                      `agent time ${(p.agent_s / 60).toFixed(0)} min`,
                    ] })}
                    onClick={() => navigate(`/jobs/${p.job}`)}>
                    <Marker kind={MARKERS[i % MARKERS.length]} x={xOf(p.effort)} y={yOf(p[metric])} color={c} />
                    <circle cx={xOf(p.effort)} cy={yOf(p[metric])} r={10} fill="transparent" />
                  </g>
                ))}
              </g>
            );
          })}
          {hover && (() => {
            const w = 250, h = 16 * hover.text.length + 12;
            const x = Math.min(hover.x + 12, W - R - w), y = Math.max(hover.y - h - 8, T);
            return (
              <g pointerEvents="none">
                <rect x={x} y={y} width={w} height={h} rx={6} fill="var(--surface2)" stroke="var(--border-hover)" />
                {hover.text.map((t, k) => <text key={k} x={x + 10} y={y + 20 + 16 * k} fill={k ? "var(--dim)" : "var(--text)"} fontSize={12}>{t}</text>)}
              </g>
            );
          })()}
        </svg>
        <div className="chart-legend">
          {agents.map(a => (
            <div key={a} className="legend-group">
              <div className="legend-agent" style={{ color: colorOf(a) }}>{a}</div>
              {all.filter(s => s.agent === a).map(s => {
                const i = styleIdx.get(sid(s)) || 0, off = hidden.has(sid(s));
                return (
                  <div key={sid(s)} className={`legend-item${off ? " off" : ""}`} onClick={() => toggle(sid(s))} title={s.version ? `version ${s.version}` : undefined}>
                    <svg width={34} height={14}>
                      <line x1={2} x2={32} y1={7} y2={7} stroke={colorOf(a)} strokeWidth={2} strokeDasharray={DASHES[i % DASHES.length]} />
                      <Marker kind={MARKERS[i % MARKERS.length]} x={17} y={7} color={colorOf(a)} />
                    </svg>
                    <span>{shortModel(s.model)}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
