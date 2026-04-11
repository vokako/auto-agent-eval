# Agent Eval — Agent Memory

## Project Overview

AI coding agent evaluation framework. Uses Terminal-Bench 2.0 / Harbor as execution layer, adds Agent-as-Judge evaluation on top.

## Key Docs

| Doc | What |
|-----|------|
| [SPEC.md](SPEC.md) | Architecture: two-layer design (execution + evaluation) |
| [docs/design-docs/architecture.md](docs/design-docs/architecture.md) | Why Harbor, why this structure |
| [docs/requirements/features/agent-adapters.md](docs/requirements/features/agent-adapters.md) | How to add new agents |
| [docs/requirements/features/agent-judge.md](docs/requirements/features/agent-judge.md) | LLM judge scoring system |
| [docs/requirements/features/task-config.md](docs/requirements/features/task-config.md) | Task YAML format |

## Directory Map

```
aae/                  # Core evaluation framework
  cli.py              # CLI: aae run / judge / compare / list
  judge.py            # LLM-based 5-dimension scoring
  rules.py            # Deterministic rule checks
  composite.py        # Weighted score combination
  tb.py               # Terminal-Bench output reader
  models.py           # Data models

agents/               # Agent adapters (one dir per agent)
  kiro_cli/           # Kiro CLI — TB + Harbor adapters
  claude_code/        # Claude Code via Bedrock — TB + Harbor adapters
  qoder_cli/          # Qoder CLI — TB + Harbor adapters

tasks/                # Task configs (dataset + agent + eval combo)
rubrics/              # Judge scoring rubrics (YAML)
datasets/             # Downloaded datasets (gitignored)
jobs/                 # Harbor run results (gitignored)
runs/                 # TB run results (gitignored)
```

## Conventions

- **Agent adapters**: each agent has `agent.yaml` (metadata), TB adapter (`*_agent.py`), Harbor adapter (`harbor_agent.py`)
- **Task configs**: `tasks/{name}.yaml` — combines dataset + agent + model + judge config
- **Rubrics**: `rubrics/{name}.yaml` — reusable judge scoring dimensions
- **Binaries**: `agents/*/bin/{version}/` — pre-downloaded agent binaries (gitignored)
- **Auth**: never committed. Kiro uses sqlite DB copy, CC uses EC2 IAM role, Qoder uses env var token

## Gotchas

- Harbor agent interface is async (`BaseInstalledAgent`), TB is sync (`AbstractInstalledAgent`) — each agent needs both adapters
- Harbor uses `upload_file()`, TB uses `copy_to_container()` for file transfer
- CC Bedrock needs `CLAUDE_CODE_USE_BEDROCK=1` + AWS creds; dummy `ANTHROPIC_API_KEY` won't work
- Kiro auth DB path differs by OS: Linux `~/.local/share/kiro-cli/`, macOS `~/Library/Application Support/kiro-cli/`
- Docker `put_archive` fails if target dir doesn't exist — use `/tmp` as staging then `mv`
- `cd /app` breaks tasks with non-standard WORKDIR (e.g. prove-plus-comm uses `/workspace`)
- TB 0.1.1 has 80 tasks, Harbor `terminal-bench-2` has 89 tasks
- Python 3.14 + typer has compatibility bug — use 3.12/3.13 for TB/Harbor

## Test Results (latest)

| Agent | Framework | Dataset | Resolved | Notes |
|-------|-----------|---------|----------|-------|
| Kiro CLI + Sonnet 4.6 | TB 0.1.1 | 80 tasks | 37/80 (46%) | with system_prompt + cd fix |
| CC + Sonnet 4.6 | TB 0.1.1 | 80 tasks | 38/80 (48%) | Bedrock |
| CC + Sonnet 4.6 | Harbor TB2 | 89 tasks | running | |
| Kiro CLI + Sonnet 4.6 | Harbor TB2 | 89 tasks | queued | |
| Qoder CLI + lite | Harbor TB2 | 89 tasks | queued | |
