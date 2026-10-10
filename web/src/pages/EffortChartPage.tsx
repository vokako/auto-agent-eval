import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type EffortPoint, type EffortSeries } from "../lib/api";
import { useFetch } from "../hooks/useFetch";

// One colour per agent (harness); models of the same agent share it and differ by dash + marker.
const AGENT_COLORS: Record<string, string> = {
  "claude-code": "#f59e0b", "codex": "#34d399", "kiro-cli": "#a78bfa",
};
const FALLBACK = ["#60a5fa", "#f87171", "#fbbf24", "#22d3ee"];
const DASHES = ["", "6 4", "2 4", "10 4 2 4", "1 3", "12 6"];
const MARKERS = ["circle", "square", "triangle", "diamond", "cross", "circle"] as const;
const EFFORT_ABBR: Record<string, string> = { none: "N", minimal: "Mn", low: "L", medium: "M", high: "H", xhigh: "XH", max: "X" };

const shortModel = (m: string) => m.replace(/^(global|us)\./, "").replace(/^(anthropic|openai)\./, "");
const score = (p: EffortPoint) => p.tasks ? (p.passed / p.tasks) * 100 : 0;

interface XAxis { key: "cost" | "time"; label: string; value: (p: EffortPoint) => number; fmt: (v: number) => string }
const X_AXES: XAxis[] = [
  { key: "cost", label: "Total cost (USD)", value: p => p.cost_usd, fmt: v => v >= 10 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}` },
  { key: "time", label: "Total agent time (min)", value: p => p.agent_s / 60, fmt: v => `${v.toFixed(0)}m` },
];

function Marker({ kind, x, y, color }: { kind: typeof MARKERS[number]; x: number; y: number; color: string }) {
  const r = 4.5;
  if (kind === "square") return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} fill={color} />;
  if (kind === "triangle") return <polygon points={`${x},${y - r - 1} ${x - r - 1},${y + r} ${x + r + 1},${y + r}`} fill={color} />;
  if (kind === "diamond") return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`} fill={color} />;
  if (kind === "cross") return <g stroke={color} strokeWidth={2.5}><line x1={x - r} y1={y - r} x2={x + r} y2={y + r} /><line x1={x - r} y1={y + r} x2={x + r} y2={y - r} /></g>;
  return <circle cx={x} cy={y} r={r} fill={color} />;
}

interface Style { color: string; dash: string; marker: typeof MARKERS[number] }

function ScoreChart({ axis, series, styleOf, logX, efforts, onOpen }: {
  axis: XAxis; series: EffortSeries[]; styleOf: (s: EffortSeries) => Style; logX: boolean;
  efforts: string[]; onOpen: (job: string) => void;
}) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string[] } | null>(null);
  const W = 760, H = 460, L = 56, R = 20, T = 30, B = 46;
  const order = (e: string) => { const i = efforts.indexOf(e); return i < 0 ? 99 : i; };

  const xs = series.flatMap(s => s.points.map(axis.value)).filter(v => v > 0);
  const useLog = logX && xs.length > 0;
  let lo = xs.length ? Math.min(...xs) : 0, hi = xs.length ? Math.max(...xs) : 1;
  if (useLog) { lo = Math.pow(10, Math.floor(Math.log10(lo))); hi = Math.pow(10, Math.ceil(Math.log10(hi))); }
  else { lo = 0; hi = hi * 1.08 || 1; }
  const xOf = (v: number) => {
    const f = useLog ? (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) : (v - lo) / (hi - lo);
    return L + f * (W - L - R);
  };
  const ys = series.flatMap(s => s.points.map(score));
  const yLo = ys.length ? Math.max(0, Math.floor((Math.min(...ys) - 5) / 10) * 10) : 0;
  const yOf = (v: number) => H - B - ((v - yLo) / (100 - yLo)) * (H - T - B);
  const yTicks = Array.from({ length: Math.round((100 - yLo) / 10) + 1 }, (_, i) => yLo + i * 10);
  const xTicks: number[] = [];
  if (useLog) for (let d = lo; d <= hi * 1.0001; d *= 10) { xTicks.push(d); if (d * 2 < hi) xTicks.push(d * 2); if (d * 5 < hi) xTicks.push(d * 5); }
  else for (let i = 0; i <= 5; i++) xTicks.push(lo + (hi - lo) * i / 5);

  return (
    <div className="score-chart">
      <div className="score-chart-title">Score vs {axis.key === "cost" ? "cost" : "time"}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="effort-chart" onMouseLeave={() => setHover(null)}>
        {yTicks.map(t => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={yOf(t)} y2={yOf(t)} stroke="var(--border)" />
            <text x={L - 8} y={yOf(t) + 4} textAnchor="end" fill="var(--dim)" fontSize={11}>{t}%</text>
          </g>
        ))}
        {xTicks.map(t => (
          <g key={t}>
            <line x1={xOf(t)} x2={xOf(t)} y1={T} y2={H - B} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={xOf(t)} y={H - B + 18} textAnchor="middle" fill="var(--dim)" fontSize={11}>{axis.fmt(t)}</text>
          </g>
        ))}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fill="var(--dim)" fontSize={12}>{axis.label}{useLog ? " · log" : ""}</text>
        <text x={14} y={(T + H - B) / 2} textAnchor="middle" fill="var(--dim)" fontSize={12} transform={`rotate(-90 14 ${(T + H - B) / 2})`}>Score (pass rate)</text>
        {series.map(s => {
          const st = styleOf(s);
          const pts = [...s.points].sort((a, b) => order(a.effort) - order(b.effort));
          return (
            <g key={`${s.agent}|${s.model}`}>
              <polyline fill="none" stroke={st.color} strokeWidth={2} strokeDasharray={st.dash} opacity={0.85}
                points={pts.map(p => `${xOf(axis.value(p))},${yOf(score(p))}`).join(" ")} />
              {pts.map(p => {
                const x = xOf(axis.value(p)), y = yOf(score(p));
                return (
                  <g key={p.effort} style={{ cursor: "pointer" }} onClick={() => onOpen(p.job)}
                    onMouseEnter={() => setHover({ x, y, text: [
                      `${s.agent} · ${shortModel(s.model)} · ${p.effort}`,
                      `score ${score(p).toFixed(1)}%  (${p.passed}/${p.tasks})`,
                      `cost $${p.cost_usd.toFixed(2)}${p.credits ? `  (${p.credits.toFixed(1)} credits)` : ""}`,
                      `agent time ${(p.agent_s / 60).toFixed(0)} min`,
                    ] })}>
                    <Marker kind={st.marker} x={x} y={y} color={st.color} />
                    <text x={x + 7} y={y - 6} fill={st.color} fontSize={10}>{EFFORT_ABBR[p.effort] || p.effort}</text>
                    <circle cx={x} cy={y} r={10} fill="transparent" />
                  </g>
                );
              })}
            </g>
          );
        })}
        {hover && (() => {
          const w = 260, h = 16 * hover.text.length + 12;
          const x = Math.min(hover.x + 12, W - R - w), y = Math.max(Math.min(hover.y - h - 8, H - B - h), T);
          return (
            <g pointerEvents="none">
              <rect x={x} y={y} width={w} height={h} rx={6} fill="var(--surface2)" stroke="var(--border-hover)" />
              {hover.text.map((t, k) => <text key={k} x={x + 10} y={y + 20 + 16 * k} fill={k ? "var(--dim)" : "var(--text)"} fontSize={12}>{t}</text>)}
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

export default function EffortChartPage() {
  const navigate = useNavigate();
  const { data, loading } = useFetch(() => api.effortCurves(), []);
  const [subset, setSubset] = useState<string>("");
  const [logCost, setLogCost] = useState(true);
  const [logTime, setLogTime] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const subsets = useMemo(() => [...new Set((data?.series || []).map(s => s.subset))].sort(), [data]);
  const cur = subset || subsets[0] || "";
  if (loading || !data) return <div className="loading">Loading…</div>;

  const all = data.series.filter(s => s.subset === cur);
  const agents = [...new Set(all.map(s => s.agent))].sort();
  const colorOf = (a: string) => AGENT_COLORS[a] || FALLBACK[agents.indexOf(a) % FALLBACK.length];
  const idx = new Map<string, number>();
  for (const a of agents) all.filter(s => s.agent === a).forEach((s, i) => idx.set(`${s.agent}|${s.model}`, i));
  const sid = (s: EffortSeries) => `${s.agent}|${s.model}`;
  const styleOf = (s: EffortSeries): Style => {
    const i = idx.get(sid(s)) || 0;
    return { color: colorOf(s.agent), dash: DASHES[i % DASHES.length], marker: MARKERS[i % MARKERS.length] };
  };
  const shown = all.filter(s => !hidden.has(sid(s)));
  const toggle = (k: string) => { const n = new Set(hidden); n.has(k) ? n.delete(k) : n.add(k); setHidden(n); };
  const open = (job: string) => navigate(`/jobs/${job}`);

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
        <label className="chk"><input type="checkbox" checked={logCost} onChange={e => setLogCost(e.target.checked)} /> log cost axis</label>
        <label className="chk"><input type="checkbox" checked={logTime} onChange={e => setLogTime(e.target.checked)} /> log time axis</label>
        <span className="muted">Each line joins one agent + model across effort (L → M → H). Kiro credits priced at $0.02.</span>
      </div>
      <div className="chart-wrap">
        <div className="chart-pair">
          <ScoreChart axis={X_AXES[0]} series={shown} styleOf={styleOf} logX={logCost} efforts={data.efforts} onOpen={open} />
          <ScoreChart axis={X_AXES[1]} series={shown} styleOf={styleOf} logX={logTime} efforts={data.efforts} onOpen={open} />
        </div>
        <div className="chart-legend">
          {agents.map(a => (
            <div key={a} className="legend-group">
              <div className="legend-agent" style={{ color: colorOf(a) }}>{a}</div>
              {all.filter(s => s.agent === a).map(s => {
                const st = styleOf(s), off = hidden.has(sid(s));
                return (
                  <div key={sid(s)} className={`legend-item${off ? " off" : ""}`} onClick={() => toggle(sid(s))} title={s.version ? `version ${s.version}` : undefined}>
                    <svg width={34} height={14}>
                      <line x1={2} x2={32} y1={7} y2={7} stroke={st.color} strokeWidth={2} strokeDasharray={st.dash} />
                      <Marker kind={st.marker} x={17} y={7} color={st.color} />
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
