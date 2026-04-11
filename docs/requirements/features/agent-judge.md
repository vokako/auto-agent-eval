# Agent Judge

## Description

LLM-based evaluation that reads agent transcripts and scores quality dimensions pytest can't capture.

## How It Works

1. Read task instruction from dataset
2. Read agent terminal output (`post-agent.txt` or agent log)
3. Read pytest output (`post-test.txt` or verifier log)
4. Build prompt with rubric dimensions
5. Call LLM (via kiro-cli-chat) to score each dimension
6. Compute composite from dimension scores (deterministic average)

## Rubric Format (`rubrics/*.yaml`)

```yaml
dimensions:
  understanding:
    description: "Did the agent correctly understand the task requirements?"
    scale: [0, 3]
    anchors:
      0: "Completely misunderstood"
      3: "Full understanding"
  approach:
    ...
```

Default rubric: 5 dimensions (understanding, approach, progress, debugging, code_quality), each 0-3.

## Composite Score

```
judge_composite = sum(dimension_scores) / (n_dimensions × max_scale)
```

Normalized to 0.0-1.0. Computed by code, not by LLM.

## Final Composite (pytest + rules + judge)

```
composite = pytest × w_pytest + rules × w_rules + judge × w_judge
```

Default weights: pytest=0.5, judge=0.5 (no rules). With rules: pytest=0.4, rules=0.3, judge=0.3.

## Value Demonstrated

- `nginx-request-logging`: pytest FAIL, judge 0.73 — config correct but in different file path
- `build-linux-kernel-qemu`: pytest FAIL, judge 0.95 — kernel compiled but timed out
- `swe-bench-fsspec`: 133/134 tests pass, judge 1.0 — near-perfect solution
