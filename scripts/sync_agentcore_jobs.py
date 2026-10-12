"""Rebuild jobs/ac-<config>/ from agentcore-bench-runner's runs/.

Usage: .venv/bin/python scripts/sync_agentcore_jobs.py [--runner ~/work/projects/agentcore-bench-runner]

One job per harness + model + effort. The runner executes the 50-task suite as two batches
(runs/fast30-<cfg> and runs/hard20-<cfg>); this script merges their trials into a single job
jobs/ac-<cfg>/<timestamp>/ with dataset "tb2-50", so the dashboard only ever sees one job. Existing jobs/ac-* dirs are replaced; trial runs
(*-r1) and the Mantle-route Codex run are skipped. Only finished trials (with a summary) are counted
for cost; unfinished ones show up as errors until the next sync.
"""
import argparse
import glob
import re
import json
import os
import shutil
from datetime import datetime, timedelta
from pathlib import Path

from aae.agentcore import convert

SKIP = {"fast30-codex-gpt61sol-mantle-high"}  # in-region Mantle route, superseded by the global run
SUBSETS = ("fast30", "hard20")  # runner batches that together make up the 50-task suite
DATASET = "tb2-50"


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
        # *-retryN / *-lostN / *-resumeN hold re-runs that retry_throttled.py merges into the parent run.
        if (name.endswith("-r1") or re.search(r"-(retry|lost|resume)\d+$", name) or name in SKIP
                or not os.path.exists(f"{rd}/results.jsonl")):
            continue
        subset, cfg = name.split("-", 1)
        if subset not in SUBSETS:
            continue
        groups.setdefault(cfg.replace("-global", ""), {})[subset] = Path(rd) / "results.jsonl"

    for old in jobs.glob("ac-*"):
        shutil.rmtree(old)
    for cfg, g in sorted(groups.items()):
        files = [g[s] for s in SUBSETS if s in g]
        rows = [json.loads(l) for f in files for l in open(f) if l.strip()]
        done = [r["summary"] for r in rows if isinstance(r.get("summary"), dict)]
        if not done:
            continue
        fins = [datetime.fromisoformat(s["finished"].replace("Z", "+00:00")) for s in done]
        start = min(f - timedelta(seconds=(s.get("timings_s") or {}).get("total") or 0) for f, s in zip(fins, done, strict=True))
        out = jobs / f"ac-{cfg}" / start.strftime("%Y-%m-%d__%H-%M-%S")
        out.mkdir(parents=True)
        outcomes = {}
        for f in files:
            of = f.parent / "outcomes.json"
            if of.exists():
                outcomes.update({rid: o["class"] for rid, o in json.load(open(of)).items()})
        convert(files, out, pricing, {}, start, max(fins), outcomes=outcomes, dataset=DATASET if len(files) == len(SUBSETS) else f"tb2-{'+'.join(s for s in SUBSETS if s in g)}")
        print(f"{cfg:26s} {len(done)}/{len(rows)} finished")


if __name__ == "__main__":
    main()
