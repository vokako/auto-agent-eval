"""Web API server for AAE dashboard."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

PROJECT_ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = PROJECT_ROOT / "jobs"
HARBOR_CACHE = Path(os.path.expanduser("~/.cache/harbor/tasks/packages/terminal-bench"))

app = FastAPI(title="AAE Dashboard")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _parse_result(result_file: Path) -> dict:
    data = json.load(open(result_file))
    evals = data.get("stats", {}).get("evals", {})
    if not evals:
        return {"tasks": {}, "started_at": data.get("started_at"), "finished_at": data.get("finished_at")}

    ev = next(iter(evals.values()))
    rs = ev.get("reward_stats", {}).get("reward", {})
    es = ev.get("exception_stats", {})

    tasks = {}
    for reward_val, task_ids in rs.items():
        for tid in task_ids:
            name = tid.split("__")[0]
            tasks[name] = {"trial_id": tid, "reward": float(reward_val), "passed": float(reward_val) >= 1.0}

    for error_type, task_ids in es.items():
        for tid in task_ids:
            name = tid.split("__")[0]
            if name not in tasks:
                tasks[name] = {"trial_id": tid, "reward": 0.0, "passed": False}
            tasks[name]["error_type"] = error_type

    return {
        "tasks": tasks,
        "n_trials": ev.get("n_trials", 0),
        "n_errors": ev.get("n_errors", 0),
        "started_at": data.get("started_at"),
        "finished_at": data.get("finished_at"),
    }


def _read_agent_info(job_dir: Path) -> tuple[str, str]:
    config_f = job_dir / "config.json"
    if not config_f.exists():
        return "", ""
    try:
        cfg = json.load(open(config_f))
        agents = cfg.get("agents", [])
        if agents:
            a = agents[0]
            import_path = a.get("import_path", "") or ""
            name = a.get("name") or ""
            if not name and import_path:
                name = import_path.split(":")[1].replace("Agent", "").replace("Cli", " CLI") if ":" in import_path else import_path
            model = a.get("model_name", "") or ""
            return name, model
    except Exception:
        pass
    return "", ""


def _agent_extra(job_dir: Path) -> dict:
    """Get builtin/custom flag and agent version from config + first trial log."""
    info = {"builtin": False, "version": ""}
    config_f = job_dir / "config.json"
    if not config_f.exists():
        return info
    try:
        a = json.load(open(config_f)).get("agents", [{}])[0]
        info["builtin"] = bool(a.get("name"))
    except Exception:
        return info

    # Extract version from first agent log
    import re
    for d in job_dir.iterdir():
        if not d.is_dir() or not ("__" in d.name):
            continue
        agent_dir = d / "agent"
        if not agent_dir.exists():
            continue
        for f in agent_dir.iterdir():
            if not f.is_file() or f.suffix != ".txt":
                continue
            try:
                head = f.read_text(errors="ignore")[:3000]
                m = re.search(r'"claude_code_version"\s*:\s*"([^"]+)"', head)
                if m:
                    info["version"] = m.group(1)
                    return info
            except Exception:
                pass
        break
    return info


def _duration_str(started: str | None, finished: str | None) -> str:
    if not started or not finished:
        return ""
    try:
        s = datetime.fromisoformat(started)
        e = datetime.fromisoformat(finished)
        secs = int((e - s).total_seconds())
        if secs < 60:
            return f"{secs}s"
        hours, rem = divmod(secs, 3600)
        mins, _ = divmod(rem, 60)
        return f"{hours}h{mins:02d}m" if hours else f"{mins}m"
    except Exception:
        return ""


@app.get("/api/jobs")
def list_jobs():
    if not JOBS_DIR.exists():
        return []

    jobs = []
    for config_dir in sorted(JOBS_DIR.iterdir()):
        if not config_dir.is_dir() or (config_dir / "result.json").exists():
            continue
        for job_dir in sorted(config_dir.iterdir(), reverse=True):
            rf = job_dir / "result.json"
            if not rf.exists():
                continue
            try:
                parsed = _parse_result(rf)
                tasks = parsed["tasks"]
                passed = sum(1 for t in tasks.values() if t["passed"])
                total = len(tasks)
                errors = sum(1 for t in tasks.values() if t.get("error_type"))
                agent_name, model_name = _read_agent_info(job_dir)
                extra = _agent_extra(job_dir)
                started = parsed.get("started_at")
                finished = parsed.get("finished_at")

                jobs.append({
                    "id": f"{config_dir.name}/{job_dir.name}",
                    "config": config_dir.name,
                    "started_at": started,
                    "agent": agent_name,
                    "model": model_name,
                    "adapter": "built-in" if extra["builtin"] else "custom",
                    "version": extra["version"],
                    "passed": passed,
                    "failed": total - passed,
                    "errors": errors,
                    "total": total,
                    "rate": round(passed / total * 100, 1) if total else 0,
                    "duration": _duration_str(started, finished),
                    "finished": finished is not None,
                })
            except Exception:
                continue
    return jobs


@app.get("/api/jobs/{config}/{timestamp}")
def get_job(config: str, timestamp: str):
    job_dir = JOBS_DIR / config / timestamp
    rf = job_dir / "result.json"
    if not rf.exists():
        raise HTTPException(404, "Job not found")

    parsed = _parse_result(rf)
    tasks = parsed["tasks"]
    agent_name, model_name = _read_agent_info(job_dir)
    extra = _agent_extra(job_dir)

    task_list = []
    for name in sorted(tasks):
        t = tasks[name]
        log_size = 0
        for d in job_dir.iterdir():
            if d.is_dir() and d.name.startswith(name + "__"):
                agent_dir = d / "agent"
                if agent_dir.exists():
                    log_size = sum(f.stat().st_size for f in agent_dir.iterdir() if f.is_file())
                break

        task_list.append({
            "name": name,
            "passed": t["passed"],
            "reward": t["reward"],
            "error_type": t.get("error_type"),
            "log_size": log_size,
        })

    return {
        "config": config,
        "timestamp": timestamp,
        "agent": agent_name,
        "model": model_name,
        "adapter": "built-in" if extra["builtin"] else "custom",
        "version": extra["version"],
        "tasks": task_list,
        "started_at": parsed.get("started_at"),
        "finished_at": parsed.get("finished_at"),
        "n_trials": parsed.get("n_trials", 0),
        "n_errors": parsed.get("n_errors", 0),
    }


@app.get("/api/jobs/{config}/{timestamp}/tasks/{task_name}")
def get_task(config: str, timestamp: str, task_name: str):
    job_dir = JOBS_DIR / config / timestamp

    trial_dir = None
    for d in job_dir.iterdir():
        if d.is_dir() and d.name.startswith(task_name + "__"):
            trial_dir = d
            break
    if not trial_dir:
        raise HTTPException(404, "Task not found")

    instruction = ""
    task_cache = HARBOR_CACHE / task_name
    if task_cache.exists():
        for root, dirs, files in os.walk(task_cache):
            if "instruction.md" in files:
                instruction = (Path(root) / "instruction.md").read_text(errors="ignore")
                break

    agent_log = ""
    agent_dir = trial_dir / "agent"
    if agent_dir.exists():
        for f in agent_dir.iterdir():
            if f.is_file() and f.suffix == ".txt":
                agent_log = f.read_text(errors="ignore")
                break

    verifier_log = ""
    verifier_dir = trial_dir / "verifier"
    if verifier_dir.exists():
        for f in verifier_dir.iterdir():
            if f.is_file():
                verifier_log = f.read_text(errors="ignore")
                break

    trial_log = ""
    trial_log_f = trial_dir / "trial.log"
    if trial_log_f.exists():
        trial_log = trial_log_f.read_text(errors="ignore")

    return {
        "name": task_name,
        "instruction": instruction,
        "agent_log": agent_log[-100000:],
        "verifier_log": verifier_log[-50000:],
        "trial_log": trial_log[-20000:],
    }


@app.get("/api/compare")
def compare(ids: str):
    job_ids = [i.strip() for i in ids.split(",") if i.strip()]
    results = {}
    for jid in job_ids:
        parts = jid.split("/")
        if len(parts) != 2:
            continue
        rf = JOBS_DIR / parts[0] / parts[1] / "result.json"
        if rf.exists():
            results[jid] = _parse_result(rf)["tasks"]

    if not results:
        raise HTTPException(404, "No jobs found")

    all_tasks = sorted(set().union(*(r.keys() for r in results.values())))
    rows = []
    for task in all_tasks:
        row = {"name": task}
        for jid in job_ids:
            t = results.get(jid, {}).get(task)
            row[jid] = {"passed": t["passed"], "error_type": t.get("error_type")} if t else None
        rows.append(row)

    summary = {}
    for jid in job_ids:
        tasks = results.get(jid, {})
        summary[jid] = {"passed": sum(1 for t in tasks.values() if t["passed"]), "total": len(tasks)}

    return {"jobs": job_ids, "tasks": rows, "summary": summary}


# Serve frontend
DIST_DIR = PROJECT_ROOT / "web" / "dist"
if DIST_DIR.exists():
    @app.get("/{path:path}")
    async def serve_spa(path: str):
        file_path = DIST_DIR / path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(DIST_DIR / "index.html")
