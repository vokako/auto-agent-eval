# Claude Code — Bedrock Adapter

Uses Claude Code CLI via AWS Bedrock. For Harbor, uses the built-in `claude-code` agent.

## Auth

EC2 IAM role — credentials fetched from instance metadata automatically.
Requires `CLAUDE_CODE_USE_BEDROCK=1` and `AWS_REGION` env vars.

## TB Usage

```bash
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_REGION=us-east-1
tb run --agent-import-path agents.claude_code.claude_code_agent:ClaudeCodeAgent \
    --model global.anthropic.claude-sonnet-4-6 ...
```

## Harbor Usage

Uses built-in agent directly:

```bash
harbor run -a claude-code -m global.anthropic.claude-sonnet-4-6 \
    --ae CLAUDE_CODE_USE_BEDROCK=1 --ae AWS_REGION=us-east-1 ...
```

## Available Models (Bedrock)

- `global.anthropic.claude-sonnet-4-6`
- `global.anthropic.claude-opus-4-6`
- `us.anthropic.claude-haiku-4-5-20251001-v1:0`

## Usage Stats

CC outputs stream-json with `total_cost_usd`, `input_tokens`, `output_tokens` per turn.
