"""CLI entry point for AAE."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import yaml

from aae import tb, judge, rules, composite
from aae.models import TaskEvalResult, RunEvalResult

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _load_task_config(task_name: str) -> dict:
    path = PROJECT_ROOT / "tasks" / f"{task_name}.yaml"
    return yaml.safe_load(path.read_text())


def _build_tb_command(cfg: dict, run_id: str) -> list[str]:
    """Build the `tb run` command from task config."""
    agent_cfg = cfg.get("agent", {})
    run_cfg = cfg.get("run", {})

    # Read import_path from agent's agent.yaml
    agent_name = agent_cfg["name"]
    agent_yaml = PROJECT_ROOT / "agents" / agent_name / "agent.yaml"
    agent_meta = yaml.safe_load(agent_yaml.read_text())

    cmd = [
        "tb", "run",
        "--agent-import-path", agent_meta["import_path"],
        "--dataset-path", str(PROJECT_ROOT / "datasets" / cfg["dataset"]),
        "--n-concurrent", str(run_cfg.get("concurrent", 4)),
        "--run-id", run_id,
    ]

    # model → --model
    if agent_cfg.get("model"):
        cmd.extend(["--model", agent_cfg["model"]])

    # kwargs → --agent-kwarg key=value
    for key, value in agent_cfg.get("kwargs", {}).items():
        cmd.extend(["--agent-kwarg", f"{key}={value}"])

    # task subset
    for t in run_cfg.get("tasks", []):
        cmd.extend(["--task-id", t])

    return cmd


def _find_completed_tasks(run_dir: Path) -> set[str]:
    """Find tasks that already have results in a run directory."""
    completed = set()
    if not run_dir.exists():
        return completed
    for task_dir in run_dir.iterdir():
        if not task_dir.is_dir():
            continue
        for trial_dir in task_dir.iterdir():
            if (trial_dir / "results.json").exists():
                completed.add(task_dir.name)
    return completed


def _find_latest_run(task_name: str) -> Path | None:
    """Find the most recent run directory for a task."""
    runs_dir = PROJECT_ROOT / "runs"
    if not runs_dir.exists():
        return None
    matches = sorted(runs_dir.glob(f"{task_name}-*"), reverse=True)
    return matches[0] if matches else None


def cmd_run(args):
    cfg = _load_task_config(args.task)
    agent_cfg = cfg.get("agent", {})
    run_cfg = cfg.get("run", {})

    # Resume: find latest run and skip completed tasks
    if args.resume:
        existing_run = _find_latest_run(args.task)
        if existing_run:
            run_id = existing_run.name
            completed = _find_completed_tasks(existing_run)
            all_tasks = run_cfg.get("tasks", [])

            if completed:
                print(f"Resuming: {run_id} ({len(completed)} tasks already done)")
                # Get remaining tasks
                if all_tasks:
                    remaining = [t for t in all_tasks if t not in completed]
                else:
                    # Full dataset — need to figure out what's left
                    dataset_path = PROJECT_ROOT / "datasets" / cfg["dataset"]
                    all_tasks = sorted(
                        d.name for d in dataset_path.iterdir()
                        if d.is_dir() and (d / "task.yaml").exists()
                    )
                    remaining = [t for t in all_tasks if t not in completed]

                if not remaining:
                    print("All tasks already completed.")
                    return

                print(f"  Remaining: {len(remaining)} tasks")
                # Override tasks in config
                run_cfg["tasks"] = remaining
                cfg["run"] = run_cfg
        else:
            print(f"No previous run found for {args.task}, starting fresh.")
            run_id = f"{args.task}-{datetime.now().strftime('%Y%m%d_%H%M')}"
    else:
        run_id = f"{args.task}-{datetime.now().strftime('%Y%m%d_%H%M')}"

    cmd = _build_tb_command(cfg, run_id)
    run_dir = PROJECT_ROOT / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    log_file = run_dir / "aae.log"

    print(f"Running: {args.task}")
    print(f"  dataset: {cfg['dataset']}")
    print(f"  agent:   {agent_cfg.get('name')} / {agent_cfg.get('model', 'auto')}")
    if agent_cfg.get("kwargs"):
        print(f"  kwargs:  {agent_cfg['kwargs']}")
    print(f"  run_id:  {run_id}")
    print(f"  log:     {log_file}")
    print(f"  cmd:     {' '.join(cmd)}")
    print()

    with open(log_file, "w") as lf:
        result = subprocess.run(cmd, cwd=PROJECT_ROOT, stdout=lf, stderr=subprocess.STDOUT)

    if result.returncode == 0:
        judge_cfg = cfg.get("judge")
        if judge_cfg and not args.no_judge:
            print("\nRunning agent judge...")
            _run_judge(
                run_dir=PROJECT_ROOT / "runs" / run_id,
                model=judge_cfg.get("model", "claude-opus-4.6"),
                rubric=judge_cfg.get("rubric", "default"),
                failed_only=judge_cfg.get("failed_only", True),
            )


def cmd_judge(args):
    _run_judge(
        run_dir=Path(args.run_dir),
        model=args.model,
        rubric=args.rubric,
        failed_only=not args.judge_all,
        task_ids=args.tasks,
    )


def _run_judge(
    run_dir: Path,
    model: str = "claude-opus-4.6",
    rubric: str = "default",
    failed_only: bool = True,
    task_ids: list[str] | None = None,
):
    tb_results = tb.load_tb_run(run_dir)

    if not task_ids:
        task_ids = [r["task_id"] for r in tb_results["results"]]
    if failed_only:
        failed = {r["task_id"] for r in tb_results["results"] if not r["is_resolved"]}
        task_ids = [t for t in task_ids if t in failed]

    print(f"Judging {len(task_ids)} tasks with {model}")
    print()

    eval_results = RunEvalResult(run_id=run_dir.name, model=model)

    for i, task_id in enumerate(task_ids):
        trial = tb.load_tb_trial(run_dir, task_id)
        if not trial:
            continue

        pytest_result = tb.to_pytest_result(trial)
        instruction = tb.load_task_instruction(task_id)
        transcript = tb.load_transcript(run_dir, task_id)
        test_output = tb.load_test_output(run_dir, task_id)
        pytest_results = trial.get("parser_results") or {}

        print(f"[{i+1}/{len(task_ids)}] {task_id}...", end=" ", flush=True)

        rules_result = rules.evaluate_rules(task_id)
        judge_result = judge.judge_task(
            task_id, instruction, transcript, test_output,
            pytest_results, model=model, rubric_name=rubric,
        )
        composite_result = composite.compute_composite(pytest_result, rules_result, judge_result)

        task_eval = TaskEvalResult(
            task_id=task_id, pytest=pytest_result,
            rules=rules_result, judge=judge_result, composite=composite_result,
        )
        eval_results.tasks.append(task_eval)

        status = "PASS" if pytest_result.is_resolved else "FAIL"
        js = f"{judge_result.composite_score:.2f}" if judge_result else "err"
        cs = f"{composite_result.score:.2f}"
        print(f"pytest={status}  judge={js}  composite={cs}")

    _print_summary(eval_results)
    out = run_dir / "aae_results.json"
    _save_results(eval_results, out)
    print(f"\nSaved to {out}")


def cmd_compare(args):
    rows = []
    for run_dir in args.run_dirs:
        p = Path(run_dir)
        for name in ("aae_results.json", "results.json"):
            if (p / name).exists():
                rows.append((p.name, json.load(open(p / name))))
                break
        else:
            print(f"No results in {run_dir}")

    if not rows:
        return

    print(f"{'Run':<50s} {'Tasks':>6s} {'Resolved':>10s} {'Composite':>10s}")
    print("-" * 80)
    for name, d in rows:
        if "tasks" in d:
            n = len(d["tasks"])
            resolved = sum(1 for t in d["tasks"] if t["pytest"]["is_resolved"])
            composites = [t["composite"]["score"] for t in d["tasks"] if t.get("composite")]
            avg = sum(composites) / len(composites) if composites else 0
        else:
            n = d.get("n_resolved", 0) + d.get("n_unresolved", 0)
            resolved = d.get("n_resolved", 0)
            avg = d.get("accuracy", 0)
        print(f"{name:<50s} {n:>6d} {resolved:>10d} {avg:>10.3f}")


def cmd_list(args):
    tasks_dir = PROJECT_ROOT / "tasks"
    for f in sorted(tasks_dir.glob("*.yaml")):
        cfg = yaml.safe_load(f.read_text())
        agent_cfg = cfg.get("agent", {})
        name = agent_cfg.get("name", "?")
        model = agent_cfg.get("model", "auto")
        kwargs = agent_cfg.get("kwargs", {})
        extra = f"  kwargs={kwargs}" if kwargs else ""
        print(f"  {f.stem:<35s} {name}/{model}  dataset={cfg.get('dataset','?')}{extra}")


def _print_summary(results: RunEvalResult):
    print()
    print("=" * 70)
    print(f"  {results.run_id}")
    print(f"  pytest resolved: {results.pytest_resolved}/{results.n_tasks}")
    print(f"  avg composite:   {results.avg_composite:.3f}")

    judged = [t for t in results.tasks if t.judge]
    if judged:
        print()
        all_dims = set()
        for t in judged:
            all_dims.update(t.judge.dimensions.keys())
        for dim in sorted(all_dims):
            scores = [t.judge.dimensions[dim].score for t in judged if dim in t.judge.dimensions]
            if scores:
                print(f"  {dim:<20s} avg={sum(scores)/len(scores):.2f}/3")

        hq = [t for t in judged if not t.pytest.is_resolved and t.judge.composite_score >= 0.6]
        if hq:
            print()
            print(f"  High-quality failures (>= 0.6): {len(hq)}")
            for t in sorted(hq, key=lambda x: -x.judge.composite_score):
                print(f"    {t.task_id:<40s} judge={t.judge.composite_score:.2f}")


def _save_results(results: RunEvalResult, path: Path):
    def to_dict(obj):
        if hasattr(obj, "__dataclass_fields__"):
            return {k: to_dict(v) for k, v in obj.__dict__.items() if v is not None}
        if isinstance(obj, list):
            return [to_dict(i) for i in obj]
        if isinstance(obj, dict):
            return {k: to_dict(v) for k, v in obj.items()}
        return obj

    path.parent.mkdir(parents=True, exist_ok=True)
    json.dump(to_dict(results), open(path, "w"), indent=2, ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser(prog="aae", description="Auto Agent Eval")
    sub = parser.add_subparsers(dest="command")

    p_run = sub.add_parser("run", help="Run a task (tb run + judge)")
    p_run.add_argument("task", help="Task name (filename in tasks/ without .yaml)")
    p_run.add_argument("--no-judge", action="store_true")
    p_run.add_argument("--resume", action="store_true", help="Resume from last run, skip completed tasks")
    p_run.set_defaults(func=cmd_run)

    p_judge = sub.add_parser("judge", help="Run judge on existing TB results")
    p_judge.add_argument("run_dir")
    p_judge.add_argument("--tasks", nargs="*")
    p_judge.add_argument("--all", action="store_true", dest="judge_all")
    p_judge.add_argument("--model", default="claude-opus-4.6")
    p_judge.add_argument("--rubric", default="default")
    p_judge.set_defaults(func=cmd_judge)

    p_compare = sub.add_parser("compare", help="Compare runs")
    p_compare.add_argument("run_dirs", nargs="+")
    p_compare.set_defaults(func=cmd_compare)

    p_list = sub.add_parser("list", help="List available tasks")
    p_list.set_defaults(func=cmd_list)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)
    args.func(args)


if __name__ == "__main__":
    main()
