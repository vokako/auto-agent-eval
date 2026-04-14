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
        return {"tasks": {}, "started_at": data.get("started_at"), "finished_at": data.get("finished_at"),
                "n_total": data.get("n_total_trials", 0)}

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
        "n_total": data.get("n_total_trials", 0),
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
    """Get builtin/custom flag, agent version, and dataset from config + first trial log."""
    info = {"builtin": False, "version": "", "dataset": ""}
    config_f = job_dir / "config.json"
    if not config_f.exists():
        return info
    try:
        cfg = json.load(open(config_f))
        a = cfg.get("agents", [{}])[0]
        info["builtin"] = bool(a.get("name"))
        datasets = cfg.get("datasets", [])
        if datasets:
            info["dataset"] = datasets[0].get("name", "")
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

    # 2. Try bin/ directory version for custom adapters
    import_path = a.get("import_path") or ""
    if import_path and ":" in import_path:
        mod_path = import_path.split(":")[0].rsplit(".", 1)[0].replace(".", "/")
        bin_dir = PROJECT_ROOT / mod_path / "bin"
        if bin_dir.exists():
            versions = sorted([d.name for d in bin_dir.iterdir() if d.is_dir()], reverse=True)
            if versions:
                info["version"] = versions[0]

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


def _sum_trial_durations(job_dir: Path) -> str:
    """Sum individual trial durations (agent actual work time)."""
    total_secs = 0
    for d in job_dir.iterdir():
        if not d.is_dir() or "__" not in d.name:
            continue
        rf = d / "result.json"
        if not rf.exists():
            continue
        try:
            t = json.load(open(rf))
            s = datetime.fromisoformat(t["started_at"].replace("Z", "+00:00"))
            e = datetime.fromisoformat(t["finished_at"].replace("Z", "+00:00"))
            total_secs += (e - s).total_seconds()
        except Exception:
            continue
    if total_secs == 0:
        return ""
    hours, rem = divmod(int(total_secs), 3600)
    mins, _ = divmod(rem, 60)
    return f"{hours}h{mins:02d}m" if hours else f"{mins}m"


@app.get("/api/jobs")
def list_jobs():
    if not JOBS_DIR.exists():
        return []

    jobs = []
    for config_dir in sorted(JOBS_DIR.iterdir()):
        if not config_dir.is_dir() or config_dir.name.startswith(".") or (config_dir / "result.json").exists():
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
                timeouts = sum(1 for t in tasks.values() if t.get("error_type") == "AgentTimeoutError")
                other_errors = errors - timeouts
                verified = total - sum(1 for t in tasks.values() if t.get("error_type") and not t["passed"] and t["reward"] == 0.0 and "reward" not in t.get("error_type", "").lower())
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
                    "dataset": extra["dataset"],
                    "passed": passed,
                    "failed": total - passed,
                    "errors": other_errors,
                    "timeouts": timeouts,
                    "total": total,
                    "rate": round(passed / total * 100, 1) if total else 0,
                    "duration": _duration_str(started, finished),
                    "total_task_time": _sum_trial_durations(job_dir),
                    "finished": finished is not None,
                    "status": "done" if finished else "running",
                    "n_total": parsed.get("n_total", 0),
                    "progress": total,
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
        trial_dir = None
        log_size = 0
        duration = ""
        cost = ""

        for d in job_dir.iterdir():
            if d.is_dir() and d.name.startswith(name + "__"):
                trial_dir = d
                break

        if trial_dir:
            agent_dir = trial_dir / "agent"
            if agent_dir.exists():
                log_size = sum(f.stat().st_size for f in agent_dir.iterdir() if f.is_file())

            # Duration from trial result.json
            trf = trial_dir / "result.json"
            if trf.exists():
                try:
                    tr = json.load(open(trf))
                    duration = _duration_str(
                        tr.get("started_at", "").replace("Z", "+00:00"),
                        tr.get("finished_at", "").replace("Z", "+00:00"),
                    )
                except Exception:
                    pass

            # Cost from agent log
            if agent_dir and agent_dir.exists():
                for f in agent_dir.iterdir():
                    if not f.is_file() or f.suffix != ".txt":
                        continue
                    try:
                        import re
                        text = f.read_text(errors="ignore")
                        # CC: stream-json with total_cost_usd
                        for line in text.splitlines():
                            if '"total_cost_usd"' in line:
                                try:
                                    d2 = json.loads(line.strip())
                                    if d2.get("type") == "result":
                                        cost = f"${d2['total_cost_usd']:.3f}"
                                        break
                                except Exception:
                                    pass
                        if not cost:
                            # Kiro: Credits: 0.44
                            credits = re.findall(r"Credits:\s*([\d.]+)", text)
                            if credits:
                                cost = f"{sum(float(c) for c in credits):.2f} cr"
                    except Exception:
                        pass
                    break

        # Test case counts from ctrf.json
        tests_passed = 0
        tests_total = 0
        if trial_dir:
            ctrf_f = trial_dir / "verifier" / "ctrf.json"
            if ctrf_f.exists():
                try:
                    s = json.load(open(ctrf_f)).get("results", {}).get("summary", {})
                    tests_total = s.get("tests", 0)
                    tests_passed = s.get("passed", 0)
                except Exception:
                    pass

        task_list.append({
            "name": name,
            "passed": t["passed"],
            "reward": t["reward"],
            "error_type": t.get("error_type"),
            "log_size": log_size,
            "duration": duration,
            "cost": cost,
            "tests_passed": tests_passed,
            "tests_total": tests_total,
        })

    return {
        "config": config,
        "timestamp": timestamp,
        "agent": agent_name,
        "model": model_name,
        "adapter": "built-in" if extra["builtin"] else "custom",
        "version": extra["version"],
        "dataset": extra["dataset"],
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

    # Instruction
    instruction = ""
    task_cache = HARBOR_CACHE / task_name
    if task_cache.exists():
        for root, dirs, files in os.walk(task_cache):
            if "instruction.md" in files:
                instruction = (Path(root) / "instruction.md").read_text(errors="ignore")
                break

    # Test cases from ctrf.json
    test_cases = []
    ctrf_f = trial_dir / "verifier" / "ctrf.json"
    if ctrf_f.exists():
        try:
            ctrf = json.load(open(ctrf_f))
            for t in ctrf.get("results", {}).get("tests", []):
                test_cases.append({
                    "name": t.get("name", "").split("::")[-1],
                    "status": t.get("status", ""),
                    "duration": round(t.get("duration", 0), 2),
                })
        except Exception:
            pass

    return {
        "name": task_name,
        "instruction": instruction,
        "test_cases": test_cases,
    }


@app.get("/api/jobs/{config}/{timestamp}/tasks/{task_name}/logs/{log_type}")
def get_task_log(config: str, timestamp: str, task_name: str, log_type: str):
    job_dir = JOBS_DIR / config / timestamp

    trial_dir = None
    for d in job_dir.iterdir():
        if d.is_dir() and d.name.startswith(task_name + "__"):
            trial_dir = d
            break
    if not trial_dir:
        raise HTTPException(404, "Task not found")

    content = ""
    if log_type == "agent":
        agent_dir = trial_dir / "agent"
        if agent_dir.exists():
            for f in agent_dir.iterdir():
                if f.is_file() and f.suffix == ".txt":
                    content = f.read_text(errors="ignore")[-100000:]
                    break
    elif log_type == "verifier":
        verifier_dir = trial_dir / "verifier"
        if verifier_dir.exists():
            for f in verifier_dir.iterdir():
                if f.is_file() and f.name != "ctrf.json":
                    content = f.read_text(errors="ignore")[-50000:]
                    break
    elif log_type == "trial":
        trial_log_f = trial_dir / "trial.log"
        if trial_log_f.exists():
            content = trial_log_f.read_text(errors="ignore")[-20000:]

    return {"content": content}


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
