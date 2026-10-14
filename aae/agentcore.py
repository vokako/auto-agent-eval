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


# Marker written to agent.txt when a trial has no usage data; the dashboard shows its cost as "—".
USAGE_MISSING = "# usage: not recorded"
# Exception type for trials the model refused (safety filter); counted apart from failures.
REFUSAL = "ModelRefusal"

# Runs before 2026-10-10 did not record the installed harness version. Those trials are backfilled with
# the version the later trials recorded, so every job shows one definite version per harness.
_BACKFILL_VERSION = {"claude-code": "2.1.296", "codex": "0.162.1", "kiro-cli": "2.29.0"}


def _inferred_version(harness: str | None, submitted: str | None = None) -> str:
    return _BACKFILL_VERSION.get(harness or "", "")


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
            started: datetime, finished: datetime, dataset: str = "",
            outcomes: dict[str, str] | None = None) -> None:
    """Write Harbor-style result.json plus one <task>__<run_id>/ dir per trial.

    results_jsonl may be one path or a list of paths; all their trials go into one job.
    outcomes maps run_id -> "refused" | "throttled" (from the runner's scripts/classify_trials.py);
    refused trials are recorded as the ModelRefusal exception instead of a timeout or error.
    """
    rewards: dict[str, list[str]] = {}
    exceptions: dict[str, list[str]] = {}
    files = results_jsonl if isinstance(results_jsonl, (list, tuple)) else [results_jsonl]
    first_summary: dict = {}
    versions_seen: set[str] = set()
    variants: set[str] = set()
    outcomes = outcomes or {}
    for line in (l for f in files for l in open(f)):
        if not line.strip():
            continue
        r = json.loads(line)
        s = r.get("summary") if isinstance(r.get("summary"), dict) else None
        if s and not first_summary:
            first_summary = s
        if s:
            versions_seen.add(s.get("harness_version") or r.get("harness_version")
                              or _inferred_version(s.get("harness") or r.get("harness"), r.get("submitted")))
        tid = f'{r["task"]}__{r.get("run_id", "none")}'
        d = out / tid
        (d / "agent").mkdir(parents=True, exist_ok=True)
        (d / "verifier").mkdir(parents=True, exist_ok=True)
        if not s:
            exceptions.setdefault(r.get("status", "Error"), []).append(tid)
            (d / "agent" / "agent.txt").write_text(r.get("error", ""))
            continue
        rewards.setdefault(f'{float(s.get("reward") or 0):.1f}', []).append(tid)
        variants.add(r.get("steering") or "")
        if outcomes.get(r.get("run_id")) == "refused":
            exceptions.setdefault(REFUSAL, []).append(tid)
        elif s.get("error"):
            exceptions.setdefault("AgentTimeoutError" if "timed out" in s["error"] else "Error", []).append(tid)
        u = s.get("usage") or {}
        harness = s.get("harness") or agent.get("name")
        lines = [f'# harness={harness} model={s.get("model")} effort={u.get("effort", agent.get("effort", ""))}']
        if not (u.get("credits") or u.get("output_tokens") or u.get("turns")):
            # The harness reported no usage for this trial (e.g. its event stream was cut off).
            lines.append(USAGE_MISSING)
        elif u.get("credits") is not None:
            lines.append(f'Credits: {u["credits"]}')
            # Credits are vendor units: only Kiro's has a known USD rate (pricing.json "kiro-credit").
            # Qoder / CodeBuddy credits are a different unit with no published USD price, so no USD.
            per = (pricing.get(f"{harness}-credit") or pricing.get("kiro-credit") or {}).get("usd_per_credit", 0.02) \
                if harness == "kiro-cli" else (pricing.get(f"{harness}-credit") or {}).get("usd_per_credit", 0)
            trial_cost = round(u["credits"] * per, 6)
            lines.append(json.dumps({"type": "result", "total_cost_usd": trial_cost, "usage": {}}))
        else:
            inp = u.get("input_tokens") or 0
            if harness == "codex":  # Codex input includes cached tokens; store uncached, like Claude Code
                inp = max(inp - (u.get("cache_read_tokens") or 0), 0)
            trial_cost = _price(pricing, s.get("model"), u, harness) or 0
            lines.append(json.dumps({"type": "result", "total_cost_usd": trial_cost,
                                     "usage": {"input_tokens": inp,
                                               "output_tokens": u.get("output_tokens") or 0,
                                               "cache_read_input_tokens": u.get("cache_read_tokens") or 0,
                                               "cache_creation_input_tokens": u.get("cache_write_tokens") or 0}}))
        (d / "agent" / "agent.txt").write_text("\n".join(lines) + "\n")
        fin = datetime.fromisoformat(s["finished"].replace("Z", "+00:00"))
        total = (s.get("timings_s") or {}).get("total") or 0
        agent_s = (s.get("timings_s") or {}).get("agent")
        t0 = fin - timedelta(seconds=total)
        json.dump({"task_name": r["task"], "trial_name": tid, "reward": s.get("reward"),
                   "started_at": t0.isoformat(), "finished_at": fin.isoformat(),
                   **({"agent_execution": {"started_at": t0.isoformat(),
                                           "finished_at": (t0 + timedelta(seconds=agent_s)).isoformat()}}
                      if agent_s is not None else {}),
                   "agentcore": {"mode": s.get("mode"), "results": r.get("results"), "usage": u,
                                 "timings_s": s.get("timings_s"), "disk_free_mb": s.get("disk_free_mb")}},
                  open(d / "result.json", "w"), indent=2)
        (d / "verifier" / "reward.txt").write_text(f'{s.get("reward")}\n')
    name = f'agentcore-{agent.get("name")}'
    json.dump({"started_at": started.isoformat(), "finished_at": finished.isoformat(),
               "stats": {"evals": {name: {"reward_stats": {"reward": rewards}, "exception_stats": exceptions}}}},
              open(out / "result.json", "w"), indent=2)
    fs = first_summary
    versions = sorted({v for v in versions_seen if v})
    json.dump({"backend": "agentcore",
               "agents": [{"name": fs.get("harness") or agent.get("name"),
                           "model_name": fs.get("model") or agent.get("model"),
                           "version": ", ".join(versions),
                           "variant": ", ".join(sorted(v for v in variants if v)),
                           "effort": (fs.get("usage") or {}).get("effort") or fs.get("effort") or agent.get("effort"),
                           "mode": fs.get("mode")}],
               "datasets": [{"name": dataset}] if dataset else []},
              open(out / "config.json", "w"), indent=2)
