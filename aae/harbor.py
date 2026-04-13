"""Read Harbor job outputs."""

from __future__ import annotations

import json
from pathlib import Path

from aae.models import PytestResult


def find_latest_job(jobs_dir: Path) -> Path | None:
    if not jobs_dir.exists():
        return None
    dirs = sorted(
        (d for d in jobs_dir.iterdir() if d.is_dir()),
        key=lambda d: d.name,
        reverse=True,
    )
    return dirs[0] if dirs else None


def load_job_results(job_dir: Path) -> dict[str, dict]:
    """Load Harbor result.json and return {task_id: {passed, reward, error_type}}."""
    result_f = job_dir / "result.json"
    if not result_f.exists():
        return {}

    data = json.load(open(result_f))
    evals = data.get("stats", {}).get("evals", {})
    if not evals:
        return {}

    ev = next(iter(evals.values()))
    rs = ev.get("reward_stats", {}).get("reward", {})
    es = ev.get("exception_stats", {})

    results = {}
    for reward_val, task_ids in rs.items():
        for tid in task_ids:
            name = tid.split("__")[0]
            results[name] = {
                "trial_id": tid,
                "reward": float(reward_val),
                "passed": float(reward_val) >= 1.0,
            }

    for error_type, task_ids in es.items():
        for tid in task_ids:
            name = tid.split("__")[0]
            if name not in results:
                results[name] = {"trial_id": tid, "reward": 0.0, "passed": False}
            results[name]["error_type"] = error_type

    return results


def _find_trial_dir(job_dir: Path, task_id: str) -> Path | None:
    for d in job_dir.iterdir():
        if d.is_dir() and d.name.startswith(task_id + "__"):
            return d
    return None


def load_agent_log(job_dir: Path, task_id: str) -> str:
    trial = _find_trial_dir(job_dir, task_id)
    if not trial:
        return ""
    agent_dir = trial / "agent"
    if not agent_dir.exists():
        return ""
    for f in agent_dir.iterdir():
        if f.is_file() and f.suffix == ".txt":
            return f.read_text(errors="ignore")
    return ""


def load_verifier_log(job_dir: Path, task_id: str) -> str:
    trial = _find_trial_dir(job_dir, task_id)
    if not trial:
        return ""
    verifier_dir = trial / "verifier"
    if not verifier_dir.exists():
        return ""
    for f in verifier_dir.iterdir():
        if f.is_file():
            return f.read_text(errors="ignore")
    return ""


def load_instruction(job_dir: Path, task_id: str) -> str:
    """Load instruction from Harbor's cached task data."""
    import os
    cache = Path(os.path.expanduser("~/.cache/harbor/tasks/packages/terminal-bench"))
    task_dir = cache / task_id
    if not task_dir.exists():
        return ""
    for root, dirs, files in os.walk(task_dir):
        if "instruction.md" in files:
            return (Path(root) / "instruction.md").read_text(errors="ignore")
    return ""


def to_pytest_result(trial: dict) -> PytestResult:
    return PytestResult(
        is_resolved=trial.get("passed", False),
        score=1.0 if trial.get("passed") else 0.0,
        results={},
    )
