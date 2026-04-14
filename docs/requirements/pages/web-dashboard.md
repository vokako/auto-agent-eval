# Web UI — Agent Eval Dashboard

## Overview

Single-page dashboard to browse Harbor benchmark results. Python backend (FastAPI) serves API from `jobs/` directory, React frontend renders it.

## Pages

### 1. Dashboard (/)

Overview of all benchmark runs.

- Table with sortable columns: Config, Agent, Adapter, Dataset, Tasks, Pass, Fail, Timeout, Error, Rate, Σ Task time, Status, Date
- Excel-style column filters (dropdown per column header) for Config, Agent, Adapter
- Range filters for Tasks count and Rate %
- Active filter tags shown above table, removable individually
- Checkbox selection for multi-job compare
- Search box for quick filtering
- Running jobs show animated progress indicator (● 46/51)

### 2. Job Detail (/jobs/:config/:timestamp)

Single benchmark run results.

- Header: Agent, Model, Adapter + version, Dataset, Date, Task Pass rate, Test Pass rate
- Progress bar: pass (green) / fail (red) / error (yellow)
- Filter tabs: all / pass / fail / timeout / error
- Task table: status icon, task name, duration, test pass count, cost, error tag
- Click task → detail panel slides in from right

### 3. Task Detail (slide-over panel)

Two tabs: Info and Files.

**Info tab:**
- Test cases: expandable list with pass/fail per pytest test case
- Instruction: task description from Harbor cache
- Agent Log / Verifier Log / Trial Log: lazy-loaded on expand (not fetched until clicked)

**Files tab:**
- File tree: all files in trial directory, grouped by folder
- Click file → preview with syntax highlighting (Prism.js)
- JSON files: interactive tree view with collapsible nodes, color-coded values

### 4. Compare (/compare?ids=a,b,c)

Side-by-side comparison of multiple jobs.

- Summary cards: pass/total and rate per job
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
- Deployment: `aae serve -p 8080`, screen session on EC2
