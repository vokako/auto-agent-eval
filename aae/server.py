"""Web API server for AAE dashboard."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

PROJECT_ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = PROJECT_ROOT / "jobs"
HARBOR_CACHE = Path(os.path.expanduser("~/.cache/harbor/tasks/packages/terminal-bench"))
# Extra task source roots (colon-separated) searched for <task>/instruction.md, e.g. a Terminal-Bench checkout.
TASK_DIRS = [Path(os.path.expanduser(p)) for p in os.environ.get("AAE_TASK_DIRS", "").split(":") if p]

# Exception type the AgentCore converter uses for model safety refusals (aae/agentcore.py REFUSAL).
REFUSAL = "ModelRefusal"

app = FastAPI(title="AAE Dashboard")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _job_dir(config: str, timestamp: str) -> Path:
    """Resolve jobs/<config>/<timestamp>, refusing anything that escapes JOBS_DIR."""
    d = (JOBS_DIR / config / timestamp).resolve()
    if not d.is_relative_to(JOBS_DIR.resolve()) or d == JOBS_DIR.resolve():
        raise HTTPException(404, "Job not found")
    return d


def _ensure_utc(ts: str | None) -> str | None:
    """Append Z to naive timestamps so browsers parse them as UTC."""
    if ts and not ts.endswith("Z") and "+" not in ts:
        return ts + "Z"
    return ts


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
        "started_at": _ensure_utc(data.get("started_at")),
        "finished_at": _ensure_utc(data.get("finished_at")),
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


def _read_run_cfg(job_dir: Path) -> dict:
    """effort / mode / adapter from config.json (written by the AgentCore backend; empty for Harbor jobs)."""
    out = {"effort": "", "mode": "", "adapter": "", "version": "", "variant": ""}
    try:
        cfg = json.load(open(job_dir / "config.json"))
        a = (cfg.get("agents") or [{}])[0]
        out["effort"] = a.get("effort") or ""
        out["mode"] = a.get("mode") or ""
        out["version"] = a.get("version") or ""
        out["variant"] = a.get("variant") or ""
        if cfg.get("backend") == "agentcore":
            out["adapter"] = f'agentcore {out["mode"]}'.strip()
    except Exception:
        pass
    return out


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


def _trial_seconds(job_dir: Path, agent_only: bool = False) -> float:
    """Sum trial durations in seconds. agent_only uses Harbor's agent_execution span when present."""
    total_secs = 0.0
    for d in job_dir.iterdir():
        if not d.is_dir() or "__" not in d.name:
            continue
        rf = d / "result.json"
        if not rf.exists():
            continue
        try:
            t = json.load(open(rf))
            span = t.get("agent_execution") if agent_only and t.get("agent_execution") else t
            s = datetime.fromisoformat(span["started_at"].replace("Z", "+00:00"))
            e = datetime.fromisoformat(span["finished_at"].replace("Z", "+00:00"))
            total_secs += (e - s).total_seconds()
        except Exception:
            continue
    return total_secs


def _sum_trial_durations(job_dir: Path) -> str:
    """Sum individual trial durations (agent actual work time)."""
    total_secs = _trial_seconds(job_dir)
    if total_secs == 0:
        return ""
    hours, rem = divmod(int(total_secs), 3600)
    mins, _ = divmod(rem, 60)
    return f"{hours}h{mins:02d}m" if hours else f"{mins}m"


    return f"{hours}h{mins:02d}m" if hours else f"{mins}m"


def _sum_job_cost(job_dir: Path) -> dict:
    """Sum cost across all trials. Returns cost_usd, credits, and token breakdown."""
    import re
    cost_usd = 0.0
    credits = 0.0
    input_tokens = 0
    output_tokens = 0
    cache_read = 0
    cache_write = 0
    usage_missing = 0
    for d in job_dir.iterdir():
        if not d.is_dir() or "__" not in d.name:
            continue
        agent_dir = d / "agent"
        if not agent_dir.exists():
            continue
        for f in agent_dir.iterdir():
            if not f.is_file() or f.suffix != ".txt":
                continue
            try:
                text = f.read_text(errors="ignore")
                if "# usage: not recorded" in text:
                    usage_missing += 1
                for line in text.splitlines():
                    if '"total_cost_usd"' in line:
                        try:
                            j2 = json.loads(line)
                            if j2.get("type") == "result":
                                cost_usd += j2.get("total_cost_usd", 0)
                                u = j2.get("usage", {})
                                input_tokens += u.get("input_tokens", 0)
                                output_tokens += u.get("output_tokens", 0)
                                cache_read += u.get("cache_read_input_tokens", 0)
                                cache_write += u.get("cache_creation_input_tokens", 0)
                        except Exception:
                            pass
                for m in re.findall(r"Credits:\s*([\d.]+)", text):
                    credits += float(m)
            except Exception:
                pass
            break
    return {
        "cost_usd": round(cost_usd, 4), "credits": round(credits, 2),
        "input_tokens": input_tokens, "output_tokens": output_tokens,
        "cache_read": cache_read, "cache_write": cache_write, "usage_missing": usage_missing,
    }


_jobs_cache: dict = {"data": None, "mtime": 0}


@app.get("/api/jobs")
def list_jobs():
    if not JOBS_DIR.exists():
        return []

    # Check if any result.json changed since last cache
    latest_mtime = 0
    for config_dir in JOBS_DIR.iterdir():
        if not config_dir.is_dir() or config_dir.name.startswith("."):
            continue
        for job_dir in config_dir.iterdir():
            rf = job_dir / "result.json"
            if rf.exists():
                latest_mtime = max(latest_mtime, rf.stat().st_mtime)

    if _jobs_cache["data"] is not None and _jobs_cache["mtime"] >= latest_mtime:
        return _jobs_cache["data"]

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
                refused = sum(1 for t in tasks.values() if t.get("error_type") == REFUSAL)
                other_errors = errors - timeouts - refused
                agent_name, model_name = _read_agent_info(job_dir)
                extra = _agent_extra(job_dir)
                run_cfg = _read_run_cfg(job_dir)
                started = parsed.get("started_at")
                finished = parsed.get("finished_at")
                cost = _sum_job_cost(job_dir) if finished else {"cost_usd": 0, "credits": 0, "input_tokens": 0,
                                                                "output_tokens": 0, "cache_read": 0, "cache_write": 0}

                jobs.append({
                    "id": f"{config_dir.name}/{job_dir.name}",
                    "config": config_dir.name,
                    "started_at": started,
                    "agent": agent_name,
                    "model": model_name,
                    "effort": run_cfg["effort"],
                    "variant": run_cfg["variant"],
                    "mode": run_cfg["mode"],
                    "adapter": run_cfg["adapter"] or ("built-in" if extra["builtin"] else "custom"),
                    "version": run_cfg["version"] or extra["version"],
                    "dataset": extra["dataset"],
                    "passed": passed,
                    "failed": total - passed,
                    "errors": other_errors,
                    "timeouts": timeouts,
                    "refused": refused,
                    "total": total,
                    "rate": round(passed / total * 100, 1) if total else 0,
                    "duration": _duration_str(started, finished),
                    "total_task_time": _sum_trial_durations(job_dir),
                    "agent_s": round(_trial_seconds(job_dir, agent_only=True)),
                    "cost_usd": cost["cost_usd"],
                    "credits": cost["credits"],
                    "input_tokens": cost["input_tokens"],
                    "output_tokens": cost["output_tokens"],
                    "cache_read": cost["cache_read"],
                    "cache_write": cost["cache_write"],
                    "usage_missing": cost.get("usage_missing", 0),
                    "finished": finished is not None,
                    "status": "done" if finished else "running",
                    "n_total": parsed.get("n_total", 0),
                    "progress": total,
                })
            except Exception:
                continue
    _jobs_cache["data"] = jobs
    _jobs_cache["mtime"] = latest_mtime
    return jobs


CACHE_DIR = PROJECT_ROOT / "jobs" / ".cache"


_EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]


@app.get("/api/effort-curves")
def effort_curves():
    """Per (agent, model): pass / cost / agent time at each effort level.

    Built from the same per-job totals as /api/jobs (all trials in the job), so the dashboard
    never needs to know how the test client grouped tasks. A job without an effort (a model that
    takes none, e.g. kiro's "auto") is a single point at effort "default".
    """
    series: dict[tuple, dict] = {}
    for j in list_jobs():
        if not j.get("finished"):
            continue
        key = (j["agent"] or "", j["model"] or "", j.get("variant") or "")
        s = series.setdefault(key, {"agent": key[0], "model": key[1], "variant": key[2],
                                    "version": j.get("version") or "", "points": []})
        s["points"].append({"effort": j.get("effort") or "default", "job": j["id"], "tasks": j["total"], "passed": j["passed"],
                            "cost_usd": j["cost_usd"], "credits": j["credits"], "agent_s": j["agent_s"]})
    for s in series.values():
        s["points"].sort(key=lambda p: _EFFORT_ORDER.index(p["effort"]) if p["effort"] in _EFFORT_ORDER else 99)
    return {"efforts": _EFFORT_ORDER, "series": sorted(series.values(), key=lambda s: (s["agent"], s["model"], s["variant"]))}


def _get_cached_job(job_dir: Path) -> dict | None:
    """Return cached job detail if result.json hasn't changed."""
    rf = job_dir / "result.json"
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_key = job_dir.relative_to(JOBS_DIR).as_posix().replace("/", "__")
    cache_f = CACHE_DIR / f"{cache_key}.json"
    if cache_f.exists():
        try:
            cached = json.load(open(cache_f))
            if cached.get("_mtime") == rf.stat().st_mtime:
                return cached
        except Exception:
            pass
    return None


def _set_cached_job(job_dir: Path, data: dict):
    rf = job_dir / "result.json"
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_key = job_dir.relative_to(JOBS_DIR).as_posix().replace("/", "__")
    cache_f = CACHE_DIR / f"{cache_key}.json"
    data["_mtime"] = rf.stat().st_mtime
    try:
        json.dump(data, open(cache_f, "w"), ensure_ascii=False)
    except Exception:
        pass


@app.get("/api/jobs/{config}/{timestamp}")
def get_job(config: str, timestamp: str):
    job_dir = _job_dir(config, timestamp)
    rf = job_dir / "result.json"
    if not rf.exists():
        raise HTTPException(404, "Job not found")

    cached = _get_cached_job(job_dir)
    if cached:
        cached.pop("_mtime", None)
        return cached

    parsed = _parse_result(rf)
    tasks = parsed["tasks"]
    agent_name, model_name = _read_agent_info(job_dir)
    extra = _agent_extra(job_dir)
    run_cfg = _read_run_cfg(job_dir)

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

    result = {
        "config": config,
        "timestamp": timestamp,
        "agent": agent_name,
        "model": model_name,
        "adapter": run_cfg["adapter"] or ("built-in" if extra["builtin"] else "custom"),
        "version": run_cfg["version"] or extra["version"],
        "effort": run_cfg["effort"],
        "variant": run_cfg["variant"],
        "dataset": extra["dataset"],
        "tasks": task_list,
        "started_at": parsed.get("started_at"),
        "finished_at": parsed.get("finished_at"),
        "n_trials": parsed.get("n_trials", 0),
        "n_errors": parsed.get("n_errors", 0),
    }

    # Cache if job is finished
    if parsed.get("finished_at"):
        _set_cached_job(job_dir, result)

    return result


@app.get("/api/jobs/{config}/{timestamp}/tasks/{task_name}/files")
def get_task_files(config: str, timestamp: str, task_name: str):
    """List all files in a trial directory as a tree."""
    job_dir = _job_dir(config, timestamp)
    trial_dir = _find_trial(job_dir, task_name)
    if not trial_dir:
        raise HTTPException(404, "Task not found")

    files = []
    for f in sorted(trial_dir.rglob("*")):
        if not f.is_file():
            continue
        rel = f.relative_to(trial_dir).as_posix()
        files.append({"path": rel, "size": f.stat().st_size})
    return files


@app.get("/api/jobs/{config}/{timestamp}/tasks/{task_name}/files/{file_path:path}")
def get_task_file(config: str, timestamp: str, task_name: str, file_path: str):
    """Read a file from a trial directory."""
    job_dir = _job_dir(config, timestamp)
    trial_dir = _find_trial(job_dir, task_name)
    if not trial_dir:
        raise HTTPException(404, "Task not found")

    target = trial_dir / file_path
    if not target.is_file() or not target.resolve().is_relative_to(trial_dir.resolve()):
        raise HTTPException(404, "File not found")

    # Cap at 500KB
    size = target.stat().st_size
    if size > 512000:
        content = target.read_text(errors="ignore")[:512000] + f"\n\n... truncated ({size} bytes total)"
    else:
        content = target.read_text(errors="ignore")

    return {"path": file_path, "content": content, "size": size}


def _find_trial(job_dir: Path, task_name: str) -> Path | None:
    for d in job_dir.iterdir():
        if d.is_dir() and d.name.startswith(task_name + "__"):
            return d
    return None


@app.get("/api/jobs/{config}/{timestamp}/tasks/{task_name}")
def get_task(config: str, timestamp: str, task_name: str):
    job_dir = _job_dir(config, timestamp)

    trial_dir = _find_trial(job_dir, task_name)
    if not trial_dir:
        raise HTTPException(404, "Task not found")

    # Instruction
    instruction = ""
    for root_dir in [HARBOR_CACHE, *TASK_DIRS]:
        task_root = root_dir / task_name
        if not task_root.exists():
            continue
        for root, _dirs, files in os.walk(task_root):
            if "instruction.md" in files:
                instruction = (Path(root) / "instruction.md").read_text(errors="ignore")
                break
        if instruction:
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
    job_dir = _job_dir(config, timestamp)

    trial_dir = _find_trial(job_dir, task_name)
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
        try:
            rf = _job_dir(parts[0], parts[1]) / "result.json"
        except HTTPException:
            continue
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

    listed = {j["id"]: j for j in list_jobs()}
    summary = {}
    for jid in job_ids:
        tasks = results.get(jid, {})
        passed = sum(1 for t in tasks.values() if t["passed"])
        total = len(tasks)
        timeouts = sum(1 for t in tasks.values() if t.get("error_type") == "AgentTimeoutError")
        refused = sum(1 for t in tasks.values() if t.get("error_type") == REFUSAL)
        errors = sum(1 for t in tasks.values() if t.get("error_type") not in (None, "AgentTimeoutError", REFUSAL))
        # Read agent/model info
        parts = jid.split("/")
        job_dir = _job_dir(parts[0], parts[1])
        agent_name, model_name = _read_agent_info(job_dir)
        j = listed.get(jid, {})
        summary[jid] = {
            "effort": j.get("effort", ""),
            "variant": j.get("variant", ""),
            "refused": refused,
            "cost_usd": j.get("cost_usd", 0),
            "credits": j.get("credits", 0),
            "agent_s": j.get("agent_s", 0),
            "passed": passed,
            "failed": total - passed,
            "total": total,
            "timeouts": timeouts,
            "errors": errors,
            "rate": round(passed / total * 100, 1) if total else 0,
            "agent": agent_name,
            "model": model_name,
        }

    return {"jobs": job_ids, "tasks": rows, "summary": summary}


# Serve frontend
DIST_DIR = PROJECT_ROOT / "web" / "dist"
if DIST_DIR.exists():
    @app.get("/{path:path}")
    async def serve_spa(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not found")
        file_path = (DIST_DIR / path).resolve()
        if file_path.is_relative_to(DIST_DIR.resolve()) and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(DIST_DIR / "index.html")
