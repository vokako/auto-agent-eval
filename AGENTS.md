# Agent Eval — Agent Memory

## Project Overview

AI coding agent evaluation framework. Uses Harbor (Terminal-Bench 2.0) as execution layer, with a web dashboard for results visualization.

## Key Docs

| Doc | What |
|-----|------|
| [docs/design-docs/architecture.md](docs/design-docs/architecture.md) | Why Harbor, two-layer design |
| [docs/requirements/features/agent-adapters.md](docs/requirements/features/agent-adapters.md) | How to add new agents |
| [docs/requirements/features/task-config.md](docs/requirements/features/task-config.md) | Task YAML format |
| [docs/requirements/pages/web-dashboard.md](docs/requirements/pages/web-dashboard.md) | Web UI pages and API |
| [docs/unresolved.md](docs/unresolved.md) | Open issues |

## Directory Map

```
aae/                  # Core framework
  cli.py              # CLI: aae run / judge / results / compare / list / serve
  harbor.py           # Harbor result reader (jobs/ format)
  server.py           # FastAPI web dashboard backend
  judge.py            # LLM-based 5-dimension scoring
  rules.py            # Deterministic rule checks
  composite.py        # Weighted score combination
  models.py           # Data models
  tb.py               # Legacy TB output reader (runs/ format, deprecated)

agents/               # Agent adapters (one dir per agent)
  kiro_cli/           # Kiro CLI — harbor_agent.py + kiro_cli_agent.py (legacy)
  claude_code/        # Claude Code via Bedrock — harbor_agent.py (pre-upload binary)
  qoder_cli/          # Qoder CLI — harbor_agent.py + qoder_cli_agent.py (legacy)

web/                  # React + Vite + TypeScript dashboard
  src/pages/          # DashboardPage, JobPage, ComparePage
  src/components/     # ColumnFilter, FileBrowser, JsonView, LazyLog, etc.
  src/hooks/          # useFetch
  src/lib/            # api, format

tasks/                # Task configs (dataset + agent + model)
  tb2-lite.txt        # 51-task lite subset (timeout <= 15min)
rubrics/              # Judge scoring rubrics
jobs/                 # Harbor run results (gitignored)
runs/                 # Legacy TB results (deprecated, gitignored)
```

## Commands

```bash
aae list                          # List task configs
aae run kiro-sonnet-lite          # Run benchmark (harbor run + optional judge)
aae run kiro-sonnet-lite --no-judge
aae results jobs/kiro-sonnet-lite/2026-04-13__13-10-40 -v
aae compare jobs/kiro-sonnet-lite/... jobs/cc-sonnet-lite/...
aae serve -p 8080                 # Start web dashboard
```

## Conventions

- **Harbor adapters**: `agents/*/harbor_agent.py` — async `BaseInstalledAgent`, uses `upload_file()` + `exec_as_agent()`
- **Task configs**: `tasks/{agent}-{model}-lite.yaml` — dataset + agent import_path + model + concurrent
- **Task list**: `tasks/tb2-lite.txt` — 51 tasks with timeout <= 15min
- **Binaries**: `agents/*/bin/{version}/` — pre-downloaded, gitignored
- **Results**: `jobs/{config}/{timestamp}/` — Harbor format with `result.json`, `*/agent/*.txt`, `*/verifier/ctrf.json`
- **Web dashboard**: FastAPI serves API from `jobs/`, React SPA from `web/dist/`
- **Caching**: `jobs/.cache/` for API response cache, invalidated by `result.json` mtime

## Gotchas

- CC refuses `--permission-mode=bypassPermissions` as root — adapter creates `agent` user and uses `su`
- CC adapter must set `ANTHROPIC_API_KEY=not-used` + `ANTHROPIC_MODEL` env var for Bedrock
- CC adapter uses `cd /app` in su command (default HOME is `/home/agent`)
- Kiro 1.29.8 rejects `execute_bash` in `--no-interactive` mode — use 1.29.6
- Docker Hub rate limit: 200 pulls/6h (logged in). Don't `docker system prune` — it deletes cached task images
- Harbor task images are `alexgshaw/*:20251031` from Docker Hub, pre-pull to avoid rate limits
- `jobs/.archive/` for failed/test runs, `jobs/.cache/` for API cache — both hidden from dashboard

## Test Results (Harbor TB2, latest)

### TB2 Lite (51 tasks, timeout <= 15min)

| Agent | Model | Pass | Rate | Timeout | Error |
|-------|-------|------|------|---------|-------|
| Qoder CLI | lite | 31/51 | 60.8% | 10 | 1 |
| Qoder CLI | Qwen3.6-Plus | 30/51 | 58.8% | 7 | 1 |
| Qoder CLI | gmodel (GLM-5) | 29/51 | 56.9% | 10 | 2 |
| Kiro CLI | claude-sonnet-4.6 | 26/51 | 51.0% | 7 | 3 |
| Kiro CLI | glm-5 | 26/51 | 51.0% | 15 | 4 |
| Kiro CLI | claude-opus-4.6 | 25/51 | 49.0% | 5 | 6 |
| CC (Bedrock) | claude-sonnet-4.6 | 21/51 | 41.2% | 14 | 1 |
| Kiro CLI | minimax-m2.5 | 11/51 | 21.6% | 27 | 11 |
| Kiro CLI | qwen3-coder-next | 7/51 | 13.7% | 25 | 14 |
| Kiro CLI | deepseek-3.2 | 5/51 | 9.8% | 31 | 7 |

### TB2 Full (89 tasks)

| Agent | Model | Pass | Rate |
|-------|-------|------|------|
| Qoder CLI | lite | 47/89 | 52.8% |
| Kiro CLI | claude-sonnet-4.6 | 46/89 | 51.7% |
| CC (built-in) | claude-sonnet-4.6 | 42/89 | 47.2% |

## Infrastructure

- EC2: i-0fb31e1f82bf95075, m7a.8xlarge (32 vCPU, 128GB), ap-northeast-1
- IP: 13.114.48.122
- Web dashboard: http://13.114.48.122:8080
- Binaries on S3: `s3://singlefiles/shares/kiro-cli/`, `s3://singlefiles/shares/qoder-cli/`
