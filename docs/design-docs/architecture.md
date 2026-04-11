# Architecture

## Context

We need to evaluate AI coding agents (Kiro CLI, Claude Code, Qoder CLI) on standardized terminal tasks and compare their performance beyond simple pass/fail.

## Decision

Two-layer architecture:

1. **Execution layer**: Harbor (formerly Terminal-Bench) — Docker sandboxes, agent interaction, pytest verification
2. **Evaluation layer**: AAE — rule checks + LLM agent judge on top of Harbor results

## Alternatives Considered

- **AAE-only**: Build our own Docker sandbox + agent interaction. Rejected — too much infrastructure work, can't compare with leaderboard.
- **Harbor-only**: Use Harbor's pass/fail. Rejected — binary scoring misses near-misses and quality differences.
- **Hybrid (chosen)**: Harbor for execution, AAE for enhanced evaluation. Best of both worlds.

## Trade-offs

- **Gained**: Leaderboard-comparable results + richer evaluation signals
- **Lost**: Dependency on Harbor's task format and agent interface
- **Complexity**: Each agent needs two adapters (TB legacy + Harbor async)

## Lessons Learned

- Docker resource contention at high concurrency (>4) causes build failures and SSH hangs on EC2
- `cd /app` in agent commands breaks tasks with non-standard WORKDIR
- Agent safety guardrails (kiro refusing security tasks) affect scores — not fixable via config
- System prompts ("don't ask questions, act autonomously") improve scores by ~5 points
- EC2 IAM role credentials must be explicitly fetched and passed to Docker containers
- Harbor's `upload_file()` vs TB's `copy_to_container()` — different APIs for same operation
