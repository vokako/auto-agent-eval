# Task Configuration

## Description

A task config (`tasks/*.yaml`) combines dataset + agent + model + evaluation settings into a single runnable definition.

## Format

```yaml
dataset: terminal-bench-core          # datasets/ subdirectory (TB) or Harbor dataset ID

agent:
  name: kiro_cli                      # agents/ subdirectory
  model: claude-sonnet-4.6            # passed to agent via --model
  system_prompt: |                    # prepended to task instruction
    You are an autonomous coding agent...
  kwargs:                             # extra args passed to agent __init__
    version: "1.29.6"

run:
  concurrent: 4                       # parallel tasks
  artifacts:                          # container paths to save after each trial (optional)
    - /app
  tasks:                              # subset (omit for all)
    - hello-world
    - fix-permissions

judge:
  model: claude-opus-4.6              # LLM for judging (separate from agent model)
  rubric: default                     # rubrics/ filename
  failed_only: false                  # judge all tasks, not just failures
```

## Naming Convention

`{agent}-{model}-{dataset}.yaml`, e.g. `kiro-sonnet-tb-core.yaml`

## How It's Used

```bash
aae list                              # show all task configs
aae run kiro-sonnet-tb-core           # run TB + judge
aae run kiro-sonnet-tb-core --no-judge
aae run kiro-sonnet-tb-core --resume  # skip completed tasks
```

## Run Output

Results saved to `runs/{task-name}-{timestamp}/` (TB) or `jobs/{name}/{timestamp}/` (Harbor).

## Harbor vs TB

The `aae` CLI currently uses TB (`tb run`). Harbor migration in progress on `harbor-migration` branch — will use `harbor run` with same task config format.
