# Web UI — Agent Eval Dashboard

## Overview

Single-page dashboard to browse Harbor benchmark results. Python backend (FastAPI) serves API from `jobs/` directory, React frontend renders it.

## Pages

### 1. Dashboard (/)

Overview of all benchmark runs.

- Table of jobs grouped by task config name (e.g. `kiro-sonnet-lite`, `cc-sonnet-v2`)
- Each row: task config, timestamp, agent, model, pass/total, pass rate %, duration
- Click row → Job Detail page
- Sort by date (newest first)

### 2. Job Detail (/jobs/:jobId)

Single benchmark run results.

- Header: agent, model, dataset, pass rate, total tasks, duration, error count
- Bar chart: pass vs fail vs error
- Task table: task name, reward (pass/fail), error type, agent log size
- Filter: all / pass / fail / error
- Click task → Task Detail panel

### 3. Task Detail (slide-over panel from Job Detail)

Single task trial details.

- Task name, reward, error type if any
- Instruction text (from Harbor cache)
- Agent log viewer (scrollable, syntax highlighted for JSON lines)
- Verifier log viewer

### 4. Compare (/compare)

Side-by-side comparison of multiple jobs.

- Select 2-3 jobs to compare
- Table: task name, result per job (pass/fail/error)
- Summary row: total pass, rate
- Highlight differences (task passed in one but failed in another)

## API Endpoints

```
GET /api/jobs                    → list of job summaries
GET /api/jobs/:id                → job detail with all task results
GET /api/jobs/:id/tasks/:task    → task detail (instruction, logs)
GET /api/compare?ids=a,b,c       → comparison data
```

## Tech Stack

- Backend: FastAPI + uvicorn, reads `jobs/` directory
- Frontend: React + Vite + TypeScript
- Styling: plain CSS (no framework)
- Deployment: `aae serve` command, port 8080
