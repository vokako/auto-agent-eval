# Qoder CLI Adapter

## Auth

`QODER_PERSONAL_ACCESS_TOKEN` env var. Get token from https://qoder.com/account/integrations

## TB Usage

```bash
export QODER_PERSONAL_ACCESS_TOKEN=pt-xxx
tb run --agent-import-path agents.qoder_cli.qoder_cli_agent:QoderCliAgent \
    --model lite ...
```

## Harbor Usage

```bash
harbor run --agent-import-path agents.qoder_cli.harbor_agent:QoderCliAgent \
    -m lite --ae QODER_PERSONAL_ACCESS_TOKEN=$QODER_PERSONAL_ACCESS_TOKEN ...
```

## Available Models

`auto`, `efficient`, `lite`, `performance`, `ultimate`, `gmodel`, `kmodel`, `mmodel`, `qmodel`, `q35model`

## Flags

- `--yolo` — skip all permission checks
- `-q` — quiet mode (hide spinner)
- `-p "prompt"` — non-interactive mode
- `--max-turns N` — limit agent iterations
