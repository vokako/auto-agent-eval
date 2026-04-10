# Kiro CLI — Terminal-Bench 适配器

让 Terminal-Bench 能跑 kiro-cli。

## 文件说明

| 文件 | 作用 |
|------|------|
| `kiro_cli_agent.py` | 实现 Terminal-Bench 的 `AbstractInstalledAgent` 接口 |
| `setup.sh.j2` | Jinja2 模板，在 Docker 容器里下载安装 kiro-cli 二进制 |
| `agent.yaml` | 配置：AWS region、版本 |

## 工作流程

1. Terminal-Bench 启动 Docker 容器
2. `setup.sh.j2` 下载 kiro-cli Linux 二进制到容器里
3. `kiro_cli_agent.py` 把宿主机的鉴权文件 (`data.sqlite3`) 复制到容器
4. 执行 `kiro-cli chat --no-interactive --trust-all-tools --model <model> <instruction>`
5. Terminal-Bench 跑 pytest 验证结果

## 鉴权

kiro-cli 登录后鉴权信息存在：
- Linux: `~/.local/share/kiro-cli/data.sqlite3`
- macOS: `~/Library/Application Support/kiro-cli/data.sqlite3`

适配器自动检测路径，复制到容器里。先在宿主机登录：

```bash
kiro-cli login
kiro-cli whoami  # 验证
```

## 用法

```bash
# 指定模型跑
tb run \
    --agent-import-path agents.kiro_cli.kiro_cli_agent:KiroCliAgent \
    --dataset-path ./datasets/terminal-bench-core \
    --model claude-sonnet-4.6 \
    --task-id hello-world

# 可用模型
# claude-sonnet-4.6, claude-opus-4.6, glm-5, minimax-m2.5, qwen3-coder-next, ...
```
