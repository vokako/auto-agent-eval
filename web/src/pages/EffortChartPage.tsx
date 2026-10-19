import { CREDIT_PRICES, FX_CNY_PER_USD } from "../lib/pricing";
import { useMemo, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type EffortPoint, type EffortSeries } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { usePersisted, setCodec } from "../hooks/usePersisted";

// One hue family per agent (harness). Models of the same agent get different shades of it and a
// dash + marker pair that is unique within the agent (30 combinations), so no two series look alike.
const AGENT_HUES: Record<string, number> = {
  "claude-code": 35, "codex": 215, "kiro-cli": 268, "kimi-code": 172, "qoder-cn": 325, "codebuddy": 115,
};
const FALLBACK_HUES = [0, 190, 55, 295, 145, 245];
const DASHES = ["", "6 4", "2 4", "10 4 2 4", "1 3", "12 6"];
const MARKERS = ["circle", "square", "triangle", "diamond", "cross"] as const;
const EFFORT_ABBR: Record<string, string> = { none: "N", minimal: "Mn", low: "L", medium: "M", high: "H", xhigh: "XH", max: "X" };

const shortModel = (m: string) => m.replace(/^(global|us)\./, "").replace(/^(anthropic|openai)\./, "");
const sid = (s: EffortSeries) => `${s.agent}|${s.model}|${s.variant}`;
const label = (s: EffortSeries) => shortModel(s.model) + (s.variant ? ` + ${s.variant}` : "");
const score = (p: EffortPoint) => p.tasks ? (p.passed / p.tasks) * 100 : 0;
const avgCost = (p: EffortPoint) => p.tasks ? p.cost_usd / p.tasks : 0;

interface XAxis { key: "cost" | "time"; label: string; value: (p: EffortPoint) => number; fmt: (v: number) => string }
const X_AXES: XAxis[] = [
  // Per scored task: tasks excludes not-run trials (quota exhausted), which also carry no cost.
  { key: "cost", label: "Avg cost per task (USD)", value: avgCost, fmt: v => v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}` },
  { key: "time", label: "Avg agent time per task (min)", value: p => p.tasks ? p.agent_s / 60 / p.tasks : 0, fmt: v => v < 10 ? `${v.toFixed(1)}m` : `${v.toFixed(0)}m` },
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

function ScoreChart({ axis, series, styleOf, logX, efforts, onOpen, focus }: {
  axis: XAxis; series: EffortSeries[]; styleOf: (s: EffortSeries) => Style; logX: boolean;
  efforts: string[]; onOpen: (job: string) => void; focus: string | null;
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
        {[...series].sort((a, b) => Number(`${a.agent}|${a.model}` === focus) - Number(`${b.agent}|${b.model}` === focus)).map(s => {
          const st = styleOf(s);
          const pts = [...s.points].sort((a, b) => order(a.effort) - order(b.effort));
          const on = focus === `${s.agent}|${s.model}|${s.variant}`, dim = focus !== null && !on;
          return (
            <g key={`${s.agent}|${s.model}|${s.variant}`} opacity={dim ? 0.15 : 1} style={{ transition: "opacity 120ms" }}>
              <polyline fill="none" stroke={st.color} strokeWidth={on ? 3.5 : 2} strokeDasharray={st.dash} opacity={on ? 1 : 0.85}
                points={pts.map(p => `${xOf(axis.value(p))},${yOf(score(p))}`).join(" ")} />
              {pts.map(p => {
                const x = xOf(axis.value(p)), y = yOf(score(p));
                return (
                  <g key={p.effort} style={{ cursor: "pointer" }} onClick={() => onOpen(p.job)}
                    onMouseEnter={() => setHover({ x, y, text: [
                      `${s.agent} · ${label(s)} · ${p.effort}`,
                      `score ${score(p).toFixed(1)}%  (${p.passed}/${p.tasks})`,
                      `avg cost $${avgCost(p).toFixed(3)}/task  (total $${p.cost_usd.toFixed(2)}${p.credits ? `, ${p.credits.toFixed(1)} credits` : ""})`,
                      `avg agent time ${p.tasks ? (p.agent_s / 60 / p.tasks).toFixed(1) : "0"} min/task`,
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
  const [params] = useSearchParams();
  const ids = useMemo(() => new Set((params.get("ids") || "").split(",").filter(Boolean)), [params]);
  const { data: raw, loading } = useFetch(() => api.effortCurves(), []);
  const [logCost, setLogCost] = usePersisted("aae.chart.logCostAxis", false);
  const [logTime, setLogTime] = usePersisted("aae.chart.logTime", false);
  const [focus, setFocus] = useState<string | null>(null);
  const [hidden, setHidden] = usePersisted<Set<string>, string[]>("aae.chart.hidden", new Set(), setCodec.encode, setCodec.decode);

  // Keep only the points (and series) belonging to the jobs ticked on the Jobs page.
  const data = useMemo(() => raw && {
    ...raw,
    series: raw.series.map(s => ({ ...s, points: s.points.filter(p => ids.has(p.job)) })).filter(s => s.points.length),
  }, [raw, ids]);
  if (loading || !data) return <div className="loading">Loading…</div>;
  if (!ids.size || !data.series.length) return (
    <>
      <AppHeader>
        <button className="btn-ghost" onClick={() => navigate("/")}>← Jobs</button>
      </AppHeader>
      <div className="loading">
        {ids.size ? "None of the selected jobs have results to plot (only AgentCore jobs do)." : "No jobs selected."}{" "}
        Tick jobs on the <a href="/" onClick={e => { e.preventDefault(); navigate("/"); }} style={{ color: "var(--blue)" }}>Jobs page</a>, then press Chart.
      </div>
    </>
  );

  const all = data.series;
  const agents = [...new Set(all.map(s => s.agent))].sort();
  // Styles are assigned over every series the API returns, not only the ticked jobs.
  const every = raw?.series ?? all;
  const unknown = [...new Set(every.map(s => s.agent))].sort().filter(a => !(a in AGENT_HUES));
  const hueOf = (a: string) => AGENT_HUES[a] ?? FALLBACK_HUES[unknown.indexOf(a) % FALLBACK_HUES.length];
  const idx = new Map<string, number>();
  const count = new Map<string, number>();
  for (const a of new Set(every.map(s => s.agent))) {
    // Stable order inside an agent, so a series keeps its style when others are ticked or unticked.
    const own = every.filter(s => s.agent === a).sort((x, y) => sid(x).localeCompare(sid(y)));
    own.forEach((s, i) => idx.set(sid(s), i));
    count.set(a, own.length);
  }
  const styleOf = (s: EffortSeries): Style => {
    const i = idx.get(sid(s)) || 0, n = count.get(s.agent) || 1;
    // Shade: hue +-12 in steps of 3, lightness spread 72% -> 48% across the agent's series.
    const hue = hueOf(s.agent) + ((i % 3) - 1) * 12;
    const rows = Math.max(Math.ceil(n / 3) - 1, 1);
    const light = n <= 1 ? 62 : 72 - Math.floor(i / 3) * (24 / rows);
    // (dash, marker) = (i mod 6, (i + floor(i/6)) mod 5): unique for i < 30.
    return { color: `hsl(${hue} 78% ${light}%)`, dash: DASHES[i % DASHES.length],
             marker: MARKERS[(i + Math.floor(i / DASHES.length)) % MARKERS.length] };
  };
  const shown = all.filter(s => !hidden.has(sid(s)));
  const toggle = (k: string) => { const n = new Set(hidden); if (n.has(k)) n.delete(k); else n.add(k); setHidden(n); };
  const open = (job: string) => navigate(`/jobs/${job}`);

  return (
    <>
      <AppHeader>
        <button className="btn-ghost" onClick={() => navigate("/")}>← Jobs</button>
      </AppHeader>
      <div className="chart-controls">
        <label className="chk"><input type="checkbox" checked={logCost} onChange={e => setLogCost(e.target.checked)} /> log cost axis</label>
        <label className="chk"><input type="checkbox" checked={logTime} onChange={e => setLogTime(e.target.checked)} /> log time axis</label>
        <span className="muted">Each line joins one agent + model across effort (L → M → H). Credits priced at {CREDIT_PRICES.map(p => `${p.label} ${p.price}`).join(", ")} ({FX_CNY_PER_USD} CNY/USD).</span>
      </div>
      <div className="chart-wrap">
        <div className="chart-pair">
          <ScoreChart axis={X_AXES[0]} series={shown} styleOf={styleOf} logX={logCost} efforts={data.efforts} onOpen={open} focus={focus} />
          <ScoreChart axis={X_AXES[1]} series={shown} styleOf={styleOf} logX={logTime} efforts={data.efforts} onOpen={open} focus={focus} />
        </div>
        <div className="chart-legend">
          {agents.map(a => (
            <div key={a} className="legend-group">
              <div className="legend-agent" style={{ color: `hsl(${hueOf(a)} 78% 62%)` }}>{a}</div>
              {all.filter(s => s.agent === a).map(s => {
                const st = styleOf(s), off = hidden.has(sid(s));
                return (
                  <div key={sid(s)} className={`legend-item${off ? " off" : ""}`} onClick={() => toggle(sid(s))} onMouseEnter={() => !off && setFocus(sid(s))} onMouseLeave={() => setFocus(null)} title={s.version ? `version ${s.version}` : undefined}>
                    <svg width={34} height={14}>
                      <line x1={2} x2={32} y1={7} y2={7} stroke={st.color} strokeWidth={2} strokeDasharray={st.dash} />
                      <Marker kind={st.marker} x={17} y={7} color={st.color} />
                    </svg>
                    <span>{label(s)}</span>
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
