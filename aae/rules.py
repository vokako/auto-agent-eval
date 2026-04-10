"""Rule checks — deterministic verification beyond pytest."""

from __future__ import annotations

import subprocess
from pathlib import Path

import yaml

from aae.models import RuleCheckResult, RulesResult

TASKS_DIR = Path(__file__).resolve().parent.parent / "tasks"


def load_eval_spec(task_id: str) -> dict | None:
    """Load AAE eval.yaml for a task, if it exists."""
    path = TASKS_DIR / task_id / "eval.yaml"
    if path.exists():
        return yaml.safe_load(path.read_text())
    return None


def run_check(check: dict, workspace: Path | None = None) -> RuleCheckResult:
    """Run a single rule check."""
    name = check.get("name", "unnamed")
    check_type = check.get("type", "command")

    if check_type == "file_exists":
        path = Path(check["path"])
        exists = path.exists()
        return RuleCheckResult(
            name=name, passed=exists, score=1.0 if exists else 0.0,
            reason=f"{'Found' if exists else 'Missing'}: {check['path']}",
        )

    if check_type == "command":
        try:
            r = subprocess.run(
                check["cmd"], shell=True, cwd=workspace,
                capture_output=True, text=True, timeout=check.get("timeout", 30),
            )
            expected = check.get("expect_exit", 0)
            passed = r.returncode == expected
            return RuleCheckResult(
                name=name, passed=passed, score=1.0 if passed else 0.0,
                reason=(r.stdout + r.stderr).strip()[-200:] or f"exit={r.returncode}",
            )
        except subprocess.TimeoutExpired:
            return RuleCheckResult(name=name, passed=False, score=0.0, reason="Timeout")

    return RuleCheckResult(name=name, passed=False, score=0.0, reason=f"Unknown type: {check_type}")


def evaluate_rules(task_id: str, workspace: Path | None = None) -> RulesResult | None:
    """Run all rule checks for a task. Returns None if no eval.yaml."""
    spec = load_eval_spec(task_id)
    if not spec or "rules" not in spec:
        return None

    checks_config = spec["rules"].get("checks", [])
    results = [run_check(c, workspace) for c in checks_config]

    if not results:
        return RulesResult(score=0.0, checks=[])

    score = sum(r.score for r in results) / len(results)
    return RulesResult(score=score, checks=results)
