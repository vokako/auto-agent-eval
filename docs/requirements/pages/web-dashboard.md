# Web UI — Agent Eval Dashboard

## Overview

Single-page dashboard to browse Harbor benchmark results. Python backend (FastAPI) serves API from `jobs/` directory, React frontend renders it.

## Pages

### 1. Dashboard (/)

Overview of all benchmark runs.

- Table with sortable columns: Config, Agent, Model, Effort, Version, Adapter, Dataset, Tasks, Pass, Fail, Timeout, Error, Rate, Σ Task, Avg/task, Cost, Credits, token columns (In / Out / Cache R / Cache W), Status, Date
- Every column has a filter: multi-select for text columns, min/max for numeric columns
- Columns menu to show/hide columns; sort, search, filters and hidden columns persist in localStorage
- Active filter tags shown above table, removable individually
- Checkbox selection (header checkbox selects all visible rows) → Chart, or Compare for 2+ jobs
- Cost shows `*` when some trials recorded no usage (their cost is not included)
- Running jobs show animated progress indicator (● 46/51)

### 2. Job Detail (/jobs/:config/:timestamp)

Single benchmark run results.

- Header: Agent, Model, effort, Adapter + version, Dataset, Date, Task Pass rate, Test Pass rate (only when the verifier produced test-case results)
- Progress bar: pass (green) / fail (red) / error (yellow)
- Filter tabs: all / pass / fail / timeout / error
- Task table: status icon, task name, duration, test pass count, cost, error tag
- Click task → detail panel slides in from right

### 3. Task Detail (slide-over panel)

Two tabs: Info and Files.

**Info tab:**
- Test cases: expandable list with pass/fail per pytest test case
- Instruction: task description from the Harbor cache or `AAE_TASK_DIRS`
- Agent Log / Verifier Log / Trial Log: lazy-loaded on expand (not fetched until clicked)

**Files tab:**
- File tree: all files in trial directory, grouped by folder
- Click file → preview with syntax highlighting (Prism.js)
- JSON files: interactive tree view with collapsible nodes, color-coded values

### 5. Score charts (/effort?ids=a,b,c)

Built only from the jobs ticked on the Dashboard.

- Two charts: score vs total cost, score vs average agent time per task
- One line per agent + model, points joined in effort order (low → medium → high); colour per agent
- Hover a legend entry to highlight its line; click to hide it; click a point to open the job
- Linear axes by default, log toggles per axis

### 4. Compare (/compare?ids=a,b,c)

Side-by-side comparison of multiple jobs.

- Summary cards: pass/total, rate, effort, cost and average agent time per task
- Filter: All tasks / Differences only
- Table: task name + result per job, diff rows highlighted

## API Endpoints

```
GET /api/jobs                                    → list of job summaries (cached)
GET /api/jobs/:config/:timestamp                 → job detail with task list (cached for finished jobs)
GET /api/jobs/:config/:timestamp/tasks/:task     → task info (instruction + test cases)
GET /api/jobs/:config/:timestamp/tasks/:task/logs/:type → lazy-load log content (agent/verifier/trial)
GET /api/jobs/:config/:timestamp/tasks/:task/files      → file tree listing
GET /api/jobs/:config/:timestamp/tasks/:task/files/:path → file content
GET /api/compare?ids=a,b,c                       → comparison data
GET /api/effort-curves                           → per agent + model points (pass, cost, agent time) by effort
```

## Caching

- Job detail: file cache in `jobs/.cache/`, keyed by config+timestamp, invalidated by `result.json` mtime
- Jobs list: in-memory cache, invalidated by latest `result.json` mtime across all jobs
- Running jobs are never cached (always fresh)

## Tech Stack

- Backend: FastAPI + uvicorn
- Frontend: React 19 + Vite 8 + TypeScript + React Router
- Syntax highlighting: Prism.js
- Styling: plain CSS (dark theme)
- Deployment: `aae serve -p 8080` (binds 127.0.0.1; put an access-controlled proxy or tunnel in front for remote access)

## Data contract

The dashboard only reads `jobs/<config>/<timestamp>/`. Test clients (Harbor, `scripts/sync_agentcore_jobs.py`) decide how tasks are grouped into a job; the dashboard computes every number from that job's trials and never needs to know about batches or task subsets.
