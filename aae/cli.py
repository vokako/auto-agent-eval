"""CLI entry point for AAE — runs Harbor benchmarks and optional LLM judge."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import yaml

from aae import harbor, judge, rules, composite
from aae.models import TaskEvalResult, RunEvalResult

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _load_task_config(task_name: str) -> dict:
    path = PROJECT_ROOT / "tasks" / f"{task_name}.yaml"
    return yaml.safe_load(path.read_text())


def _load_task_list(filename: str) -> list[str]:
    path = PROJECT_ROOT / "tasks" / filename
    return [
        line.strip()
        for line in path.read_text().splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


def _expand_env(val: str) -> str:
    if isinstance(val, str) and val.startswith("${") and val.endswith("}"):
        return os.environ.get(val[2:-1], "")
    return str(val)


def _build_harbor_command(cfg: dict, jobs_dir: str) -> list[str]:
    agent_cfg = cfg.get("agent", {})
    run_cfg = cfg.get("run", {})

    cmd = [
        "harbor", "run",
        "-d", cfg["dataset"],
        "--agent-import-path", agent_cfg["import_path"],
        "-n", str(run_cfg.get("concurrent", 4)),
        "--jobs-dir", jobs_dir,
    ]

    if agent_cfg.get("model"):
        cmd.extend(["-m", agent_cfg["model"]])

    for k, v in agent_cfg.get("env", {}).items():
        cmd.extend(["--ae", f"{k}={_expand_env(v)}"])

    # Task subset from task_list file
    if cfg.get("task_list"):
        tasks = _load_task_list(cfg["task_list"])
        for t in tasks:
            cmd.extend(["-i", t])

    # Artifacts to collect from container
    for a in run_cfg.get("artifacts", []):
        cmd.extend(["--artifact", a])

    return cmd


def cmd_run(args):
    cfg = _load_task_config(args.task)
    agent_cfg = cfg.get("agent", {})

    jobs_dir = str(PROJECT_ROOT / "jobs" / args.task)
    cmd = _build_harbor_command(cfg, jobs_dir)

    print(f"Running: {args.task}")
    print(f"  dataset: {cfg['dataset']}")
    print(f"  agent:   {agent_cfg.get('name')} / {agent_cfg.get('model', 'auto')}")
    print(f"  jobs:    {jobs_dir}")
    print(f"  cmd:     {' '.join(cmd)}")
    print()

    result = subprocess.run(cmd, cwd=PROJECT_ROOT)

    # Copy task yaml into job dir for reproducibility
    job_dir = harbor.find_latest_job(Path(jobs_dir))
    if job_dir:
        import shutil
        task_yaml = PROJECT_ROOT / "tasks" / f"{args.task}.yaml"
        if task_yaml.exists():
            shutil.copy2(task_yaml, job_dir / "task.yaml")

    if result.returncode == 0 and not args.no_judge:
        judge_cfg = cfg.get("judge")
        if judge_cfg:
            job_dir = harbor.find_latest_job(Path(jobs_dir))
            if job_dir:
                print("\nRunning agent judge...")
                _run_judge(
                    job_dir=job_dir,
                    model=judge_cfg.get("model", "claude-opus-4.6"),
                    rubric=judge_cfg.get("rubric", "default"),
                    failed_only=judge_cfg.get("failed_only", False),
                )


def cmd_judge(args):
    _run_judge(
        job_dir=Path(args.job_dir),
        model=args.model,
        rubric=args.rubric,
        failed_only=args.failed_only,
        task_ids=args.tasks,
    )


def _run_judge(
    job_dir: Path,
    model: str = "claude-opus-4.6",
    rubric: str = "default",
    failed_only: bool = False,
    task_ids: list[str] | None = None,
):
    results = harbor.load_job_results(job_dir)
    if not results:
        print(f"No results found in {job_dir}")
        return

    if not task_ids:
        task_ids = list(results.keys())
    if failed_only:
        task_ids = [t for t in task_ids if not results.get(t, {}).get("passed")]

    print(f"Judging {len(task_ids)} tasks with {model}")
    print()

    eval_results = RunEvalResult(run_id=job_dir.name, model=model)

    for i, task_id in enumerate(task_ids):
        trial = results.get(task_id)
        if not trial:
            continue

        pytest_result = harbor.to_pytest_result(trial)
        instruction = harbor.load_instruction(job_dir, task_id)
        transcript = harbor.load_agent_log(job_dir, task_id)
        test_output = harbor.load_verifier_log(job_dir, task_id)

        print(f"[{i+1}/{len(task_ids)}] {task_id}...", end=" ", flush=True)

        rules_result = rules.evaluate_rules(task_id)
        judge_result = judge.judge_task(
            task_id, instruction, transcript, test_output,
            {}, model=model, rubric_name=rubric,
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
    out = job_dir / "aae_results.json"
    _save_results(eval_results, out)
    print(f"\nSaved to {out}")


def cmd_results(args):
    job_dir = Path(args.job_dir)
    results = harbor.load_job_results(job_dir)
    if not results:
        print(f"No results in {job_dir}")
        return

    passed = sum(1 for r in results.values() if r.get("passed"))
    total = len(results)
    errors = sum(1 for r in results.values() if r.get("error"))

    print(f"Job: {job_dir.name}")
    print(f"Resolved: {passed}/{total} ({passed*100/total:.1f}%)")
    if errors:
        print(f"Errors: {errors}")
    print()

    if args.verbose:
        for task_id in sorted(results):
            r = results[task_id]
            status = "PASS" if r.get("passed") else "FAIL"
            err = f" [{r['error_type']}]" if r.get("error_type") else ""
            print(f"  {task_id:<45} {status}{err}")


def cmd_compare(args):
    rows = []
    for d in args.job_dirs:
        p = Path(d)
        if not p.exists():
            # Try as task name
            task_jobs = PROJECT_ROOT / "jobs" / d
            if task_jobs.exists():
                p = harbor.find_latest_job(task_jobs) or p

        results = harbor.load_job_results(p)
        if results:
            passed = sum(1 for r in results.values() if r.get("passed"))
            total = len(results)
            rows.append((p.name, total, passed))
        else:
            # Try aae_results.json
            aae_f = p / "aae_results.json"
            if aae_f.exists():
                d = json.load(open(aae_f))
                n = len(d.get("tasks", []))
                resolved = sum(1 for t in d["tasks"] if t["pytest"]["is_resolved"])
                rows.append((p.name, n, resolved))

    if not rows:
        print("No results found")
        return

    print(f"{'Run':<55} {'Tasks':>6} {'Resolved':>10} {'Rate':>8}")
    print("-" * 82)
    for name, total, passed in rows:
        print(f"{name:<55} {total:>6} {passed:>10} {passed*100/total:>7.1f}%")


def cmd_list(args):
    tasks_dir = PROJECT_ROOT / "tasks"
    for f in sorted(tasks_dir.glob("*.yaml")):
        cfg = yaml.safe_load(f.read_text())
        agent_cfg = cfg.get("agent", {})
        dataset = cfg.get("dataset", "?")
        task_list = cfg.get("task_list", "all")
        model = agent_cfg.get("model", "auto")
        print(f"  {f.stem:<30} {agent_cfg.get('name','?')}/{model}  {dataset}  [{task_list}]")


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


def cmd_serve(args):
    import uvicorn
    print(f"Starting AAE dashboard on http://0.0.0.0:{args.port}")
    uvicorn.run("aae.server:app", host="0.0.0.0", port=args.port, reload=args.reload)


def main():
    parser = argparse.ArgumentParser(prog="aae", description="Agent Eval (Harbor)")
    sub = parser.add_subparsers(dest="command")

    p_run = sub.add_parser("run", help="Run a task (harbor run + optional judge)")
    p_run.add_argument("task", help="Task name (filename in tasks/ without .yaml)")
    p_run.add_argument("--no-judge", action="store_true")
    p_run.set_defaults(func=cmd_run)

    p_judge = sub.add_parser("judge", help="Run judge on existing Harbor results")
    p_judge.add_argument("job_dir")
    p_judge.add_argument("--tasks", nargs="*")
    p_judge.add_argument("--failed-only", action="store_true")
    p_judge.add_argument("--model", default="claude-opus-4.6")
    p_judge.add_argument("--rubric", default="default")
    p_judge.set_defaults(func=cmd_judge)

    p_results = sub.add_parser("results", help="Show results from a Harbor job")
    p_results.add_argument("job_dir")
    p_results.add_argument("-v", "--verbose", action="store_true")
    p_results.set_defaults(func=cmd_results)

    p_compare = sub.add_parser("compare", help="Compare runs")
    p_compare.add_argument("job_dirs", nargs="+")
    p_compare.set_defaults(func=cmd_compare)

    p_list = sub.add_parser("list", help="List available tasks")
    p_list.set_defaults(func=cmd_list)

    p_serve = sub.add_parser("serve", help="Start web dashboard")
    p_serve.add_argument("-p", "--port", type=int, default=8080)
    p_serve.add_argument("--reload", action="store_true")
    p_serve.set_defaults(func=cmd_serve)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)
    args.func(args)


if __name__ == "__main__":
    main()
