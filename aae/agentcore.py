"""AgentCore backend for `aae run`: runs tasks in Bedrock AgentCore sandboxes
(microVM or Runtime Instances) through agentcore-bench-runner, then writes the results
in Harbor's jobs/ layout so `aae results`, `aae compare` and the dashboard read them as-is.

Task YAML (backend: agentcore):

    backend: agentcore
    task_list: tb2-fast30.txt          # tasks/<file>, one task name per line
    agentcore:
      runner: ~/work/projects/agentcore-bench-runner
      tasks_dir: ~/work/pocs/2026-09-28-agentcore-bench-runner/tb2   # Harbor task dirs
      mode: microvm                    # or instances
      image: <registry>/bench/{task}:arm64
      config: config.json              # runner config (relative to runner)
      jobs: 5
    agent:
      name: claude-code                # runner harness: claude-code | codex | kiro-cli
      model: global.anthropic.claude-sonnet-5-5
      effort: high
      model_region: us-east-2          # optional

Cost written into each trial is recomputed from tokens with the runner's
benchmarks/pricing.json; kiro-cli reports credits instead.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _expand(p: str) -> Path:
    return Path(os.path.expanduser(p))


def _price(pricing: dict, model: str, usage: dict, harness: str) -> float | None:
    p = pricing.get(model)
    if not p or p.get("input") is None:
        return None
    cr = usage.get("cache_read_tokens") or 0
    cw = usage.get("cache_write_tokens") or 0
    inp = usage.get("input_tokens") or 0
    if harness == "codex":  # Codex input_tokens includes the cached part
        inp = max(inp - cr, 0)
    return (inp * p["input"] + (usage.get("output_tokens") or 0) * p["output"]
            + cr * p["cache_read"] + cw * p["cache_write"]) / 1e6


def run(cfg: dict, task_names: list[str], jobs_dir: Path) -> Path:
    ac = cfg["agentcore"]
    agent = cfg.get("agent", {})
    runner = _expand(ac["runner"])
    tasks_dir = _expand(ac["tasks_dir"])
    stamp = time.strftime("%Y-%m-%d__%H-%M-%S")
    out = jobs_dir / stamp
    raw = out / ".agentcore"
    raw.mkdir(parents=True, exist_ok=True)
    cmd = ["uv", "run", "-q", "--python", "3.12", "--with", "boto3", "python", "runner/batch.py",
           "--config", ac.get("config", "config.json"), "--mode", ac.get("mode", "microvm"),
           "--image", ac["image"], "--harness", agent["name"], "--jobs", str(ac.get("jobs", 5)),
           "--out", str(raw)]
    for flag, key in (("--model", "model"), ("--effort", "effort"), ("--model-region", "model_region")):
        if agent.get(key):
            cmd += [flag, str(agent[key])]
    cmd += [str(tasks_dir / t) for t in task_names]
    started = datetime.now(timezone.utc)
    print("  cmd:", " ".join(cmd[:24]), "...")
    subprocess.run(cmd, cwd=runner, stdin=subprocess.DEVNULL)
    convert(raw / "results.jsonl", out, json.load(open(runner / "benchmarks" / "pricing.json")),
            agent, started, datetime.now(timezone.utc))
    return out


def convert(results_jsonl: Path, out: Path, pricing: dict, agent: dict,
            started: datetime, finished: datetime) -> None:
    """Write Harbor-style result.json plus one <task>__<run_id>/ dir per trial."""
    rewards: dict[str, list[str]] = {}
    exceptions: dict[str, list[str]] = {}
    for line in open(results_jsonl):
        if not line.strip():
            continue
        r = json.loads(line)
        s = r.get("summary") if isinstance(r.get("summary"), dict) else None
        tid = f'{r["task"]}__{r.get("run_id", "none")}'
        d = out / tid
        (d / "agent").mkdir(parents=True, exist_ok=True)
        (d / "verifier").mkdir(parents=True, exist_ok=True)
        if not s:
            exceptions.setdefault(r.get("status", "Error"), []).append(tid)
            (d / "agent" / "agent.txt").write_text(r.get("error", ""))
            continue
        rewards.setdefault(f'{float(s.get("reward") or 0):.1f}', []).append(tid)
        if s.get("error"):
            exceptions.setdefault("AgentTimeoutError" if "timed out" in s["error"] else "Error", []).append(tid)
        u = s.get("usage") or {}
        harness = s.get("harness") or agent.get("name")
        lines = [f'# harness={harness} model={s.get("model")} effort={u.get("effort", agent.get("effort", ""))}']
        if u.get("credits") is not None:
            lines.append(f'Credits: {u["credits"]}')
            per = (pricing.get("kiro-credit") or {}).get("usd_per_credit", 0.02)
            lines.append(json.dumps({"type": "result", "total_cost_usd": round(u["credits"] * per, 6), "usage": {}}))
        else:
            lines.append(json.dumps({"type": "result", "total_cost_usd": _price(pricing, s.get("model"), u, harness) or 0,
                                     "usage": {"input_tokens": u.get("input_tokens") or 0,
                                               "output_tokens": u.get("output_tokens") or 0,
                                               "cache_read_input_tokens": u.get("cache_read_tokens") or 0,
                                               "cache_creation_input_tokens": u.get("cache_write_tokens") or 0}}))
        (d / "agent" / "agent.txt").write_text("\n".join(lines) + "\n")
        fin = datetime.fromisoformat(s["finished"].replace("Z", "+00:00"))
        total = (s.get("timings_s") or {}).get("total") or 0
        json.dump({"task_name": r["task"], "trial_name": tid, "reward": s.get("reward"),
                   "started_at": (fin - timedelta(seconds=total)).isoformat(), "finished_at": fin.isoformat(),
                   "agentcore": {"mode": s.get("mode"), "results": r.get("results"), "usage": u,
                                 "timings_s": s.get("timings_s"), "disk_free_mb": s.get("disk_free_mb")}},
                  open(d / "result.json", "w"), indent=2)
        (d / "verifier" / "reward.txt").write_text(f'{s.get("reward")}\n')
    name = f'agentcore-{agent.get("name")}'
    json.dump({"started_at": started.isoformat(), "finished_at": finished.isoformat(),
               "stats": {"evals": {name: {"reward_stats": {"reward": rewards}, "exception_stats": exceptions}}}},
              open(out / "result.json", "w"), indent=2)
