"""Read Terminal-Bench run outputs."""

from __future__ import annotations

import json
import re
from pathlib import Path

from aae.models import PytestResult


def load_tb_run(run_dir: Path) -> dict:
    """Load Terminal-Bench results.json."""
    return json.load(open(run_dir / "results.json"))


def load_tb_trial(run_dir: Path, task_id: str) -> dict | None:
    """Load per-task trial result."""
    task_dir = run_dir / task_id
    for trial_dir in task_dir.glob("*/"):
        rf = trial_dir / "results.json"
        if rf.exists():
            return json.load(open(rf))
    return None


def load_transcript(run_dir: Path, task_id: str) -> str:
    """Load agent terminal transcript."""
    for pane in (run_dir / task_id).glob("*/panes/post-agent.txt"):
        return pane.read_text(errors="ignore")
    return ""


def load_test_output(run_dir: Path, task_id: str) -> str:
    """Load pytest output."""
    for pane in (run_dir / task_id).glob("*/panes/post-test.txt"):
        return pane.read_text(errors="ignore")
    return ""


def load_task_instruction(task_id: str, dataset_path: Path | None = None) -> str:
    """Load task instruction from dataset directory."""
    if dataset_path is None:
        project_root = Path(__file__).resolve().parent.parent
        dataset_path = project_root / "datasets" / "terminal-bench-core"
    task_yaml = dataset_path / task_id / "task.yaml"
    if not task_yaml.exists():
        return ""
    import yaml
    cfg = yaml.safe_load(task_yaml.read_text())
    if isinstance(cfg.get("instruction"), str):
        return cfg["instruction"]
    if isinstance(cfg.get("descriptions"), list):
        return cfg["descriptions"][0].get("description", "")
    return ""


def extract_credits(run_dir: Path, task_id: str) -> float:
    """Extract kiro-cli credit usage from transcript."""
    transcript = load_transcript(run_dir, task_id)
    return sum(float(m) for m in re.findall(r"Credits:\s*([\d.]+)", transcript))


def to_pytest_result(trial: dict) -> PytestResult:
    """Convert TB trial result to PytestResult."""
    results = trial.get("parser_results") or {}
    return PytestResult(
        is_resolved=trial.get("is_resolved", False),
        score=1.0 if trial.get("is_resolved") else 0.0,
        results=results,
    )
