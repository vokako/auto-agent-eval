"""Rebuild jobs/ac-<config>/ from agentcore-bench-runner's runs/ (Fast30 + Hard20 merged per config).

Usage: .venv/bin/python scripts/sync_agentcore_jobs.py [--runner ~/work/projects/agentcore-bench-runner]

One job per harness + model + effort. runs/fast30-<cfg> and runs/hard20-<cfg> become subsets
"fast30" / "hard20" of jobs/ac-<cfg>/<timestamp>/. Existing jobs/ac-* dirs are replaced; trial runs
(*-r1) and the Mantle-route Codex run are skipped. Only finished trials (with a summary) are counted
for cost; unfinished ones show up as errors until the next sync.
"""
import argparse
import glob
import json
import os
import shutil
from datetime import datetime, timedelta
from pathlib import Path

from aae.agentcore import convert

SKIP = {"fast30-codex-gpt61sol-high"}  # in-region Mantle route, superseded by the global run
SUBSETS = ("fast30", "hard20")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runner", default="~/work/projects/agentcore-bench-runner")
    ap.add_argument("--jobs", default="jobs")
    a = ap.parse_args()
    runner = Path(os.path.expanduser(a.runner))
    jobs = Path(a.jobs)
    pricing = json.load(open(runner / "benchmarks" / "pricing.json"))

    groups: dict[str, dict[str, Path]] = {}
    for rd in sorted(glob.glob(str(runner / "runs" / "*"))):
        name = os.path.basename(rd)
        if name.endswith("-r1") or name in SKIP or not os.path.exists(f"{rd}/results.jsonl"):
            continue
        subset, cfg = name.split("-", 1)
        if subset not in SUBSETS:
            continue
        groups.setdefault(cfg.replace("-global", ""), {})[subset] = Path(rd) / "results.jsonl"

    for old in jobs.glob("ac-*"):
        shutil.rmtree(old)
    for cfg, g in sorted(groups.items()):
        files = [(s, g[s]) for s in SUBSETS if s in g]
        rows = [json.loads(l) for _, f in files for l in open(f) if l.strip()]
        done = [r["summary"] for r in rows if isinstance(r.get("summary"), dict)]
        if not done:
            continue
        fins = [datetime.fromisoformat(s["finished"].replace("Z", "+00:00")) for s in done]
        start = min(f - timedelta(seconds=(s.get("timings_s") or {}).get("total") or 0) for f, s in zip(fins, done))
        label = "+".join(s for s, _ in files)
        out = jobs / f"ac-{cfg}" / start.strftime("%Y-%m-%d__%H-%M-%S")
        out.mkdir(parents=True)
        convert(files, out, pricing, {}, start, max(fins), dataset=f"tb2-{label}")
        print(f"{cfg:26s} {label:14s} {len(done)}/{len(rows)} finished")


if __name__ == "__main__":
    main()
