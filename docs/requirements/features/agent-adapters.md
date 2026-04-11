# Agent Adapters

## Description

Each agent (Kiro CLI, Claude Code, Qoder CLI) needs adapters to run inside Terminal-Bench and Harbor Docker sandboxes.

## Structure

```
agents/{name}/
├── agent.yaml           # Metadata: name, import paths
├── {name}_agent.py      # TB adapter (sync, AbstractInstalledAgent)
├── harbor_agent.py      # Harbor adapter (async, BaseInstalledAgent)
├── setup.sh.j2          # TB install script template (optional)
└── bin/{version}/       # Pre-downloaded binaries (gitignored)
```

## agent.yaml Format

```yaml
name: kiro-cli
import_path: agents.kiro_cli.kiro_cli_agent:KiroCliAgent          # TB
harbor_import_path: agents.kiro_cli.harbor_agent:KiroCliAgent      # Harbor
```

## Adding a New Agent

1. Create `agents/{name}/` directory
2. Write `agent.yaml` with import paths
3. Implement TB adapter inheriting `terminal_bench.agents.installed_agents.abstract_installed_agent.AbstractInstalledAgent`
4. Implement Harbor adapter inheriting `harbor.agents.installed.base.BaseInstalledAgent`
5. Key methods:
   - TB: `_env`, `_install_agent_script_path`, `_run_agent_commands(instruction)`, `perform_task()`
   - Harbor: `install(environment)`, `run(instruction, environment, context)`, `populate_context_post_run(context)`
6. Add binary to `bin/{version}/` (gitignored)
7. Create task config in `tasks/{name}-{model}-tb-core.yaml`

## Auth Patterns

| Agent | Auth Method | How |
|-------|-------------|-----|
| Kiro CLI | sqlite DB | Copy `~/.local/share/kiro-cli/data.sqlite3` into container |
| Claude Code | AWS IAM | Fetch EC2 metadata credentials, pass as env vars |
| Qoder CLI | Token | `QODER_PERSONAL_ACCESS_TOKEN` env var |

## Constraints

- Binaries must match container architecture (x86_64 for x86 EC2)
- Auth files/tokens never committed to git
- Harbor adapters are async; TB adapters are sync
- `system_prompt` kwarg prepended to task instruction for autonomous behavior
