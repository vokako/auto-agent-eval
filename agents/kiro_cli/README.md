# Kiro CLI Adapter

## Auth

sqlite DB copied into container from host:
- Linux: `~/.local/share/kiro-cli/data.sqlite3`
- macOS: `~/Library/Application Support/kiro-cli/data.sqlite3`

Login on host first: `kiro-cli login && kiro-cli whoami`

## Binary

Pre-downloaded to `bin/{version}/kiro-cli-chat` (gitignored). Only `kiro-cli-chat` needed (378MB x86_64).

Download: `https://du7u4d2q1sjz6.cloudfront.net/kiro-cli/kiro-cli-chat-{version}-x86_64-linux.gz`

## TB Usage

```bash
tb run --agent-import-path agents.kiro_cli.kiro_cli_agent:KiroCliAgent \
    --model claude-sonnet-4.6 ...
```

## Harbor Usage

```bash
harbor run --agent-import-path agents.kiro_cli.harbor_agent:KiroCliAgent \
    -m claude-sonnet-4.6 ...
```

## Available Models

`auto`, `claude-opus-4.6`, `claude-sonnet-4.6`, `claude-haiku-4.5`, `deepseek-3.2`, `kimi-k2.5`, `minimax-m2.5`, `glm-5`, `qwen3-coder-next`

## Flags

- `--no-interactive` — non-interactive mode
- `--trust-all-tools` / `-a` — skip tool approval
- `--wrap never` — no line wrapping
- `--model X` — model selection

## Usage Stats

Credits parsed from terminal output: `▸ Credits: 0.07 • Time: 4s`
