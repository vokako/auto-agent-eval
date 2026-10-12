# Agent Eval (AAE)

AI coding agent 评测工具：用 [Harbor](https://github.com/harbor-framework/harbor) 或 Amazon Bedrock AgentCore 沙箱跑 [Terminal-Bench 2.0](https://www.tbench.ai/) 一类的任务，把结果汇总到一个 Web 看板里，按 agent / 模型 / effort 对比通过率、成本和耗时。

两层分工：

- **执行层**（测试客户端）：Harbor `harbor run`，或 [agentcore-bench-runner](https://github.com/vokako/agentcore-bench-runner) 在 AgentCore microVM 里跑。负责跑任务、统计 token / credit，并把结果写成 Harbor 的 `jobs/` 格式。
- **展示层**（`aae serve`）：只读 `jobs/`，按每个 job 里的 trial 统计，不关心任务是怎么分批跑的。

## 目录

```
aae/
  cli.py          # 命令行：aae run / results / compare / judge / list / serve
  server.py       # 看板后端（FastAPI），读 jobs/
  agentcore.py    # AgentCore 后端：调用 agentcore-bench-runner，结果转成 Harbor jobs/ 格式
  harbor.py       # 读 Harbor 结果
  judge.py rules.py composite.py   # LLM Judge 增强评估（可选）
agents/           # Harbor agent 适配器：claude_code / kiro_cli / qoder_cli
tasks/            # 任务配置 YAML（数据集 + agent + 模型 + effort）和任务清单 *.txt
scripts/
  sync_agentcore_jobs.py   # 把 agentcore-bench-runner 的 runs/ 同步成 jobs/ac-*
web/              # React + Vite + TypeScript 看板前端
jobs/             # 运行结果（git ignored）
```

## 安装

```bash
uv sync                      # Python 3.12+
cd web && npm ci && npm run build && cd ..
```

## 跑测试

### Harbor（本地 Docker）

```bash
# Claude Code（Bedrock）
harbor run -d terminal-bench/terminal-bench-2 -a claude-code \
    -m global.anthropic.claude-sonnet-4-6 \
    --ae CLAUDE_CODE_USE_BEDROCK=1 --ae AWS_REGION=us-east-1 -n 4

# Kiro CLI（自定义适配器）
harbor run -d terminal-bench/terminal-bench-2 \
    --agent-import-path agents.kiro_cli.harbor_agent:KiroCliAgent \
    -m claude-sonnet-4.6 -n 4
```

或者用任务配置：`aae list` 列出 `tasks/*.yaml`，`aae run <name>` 运行。

### AgentCore（microVM 沙箱）

任务配置里写 `backend: agentcore`，`aae run` 会调用 agentcore-bench-runner，再把结果写进 `jobs/`。配置格式见 `aae/agentcore.py` 顶部的说明。

如果直接用 agentcore-bench-runner 跑（例如它的 `scripts/sweep.sh`），跑完后同步到看板：

```bash
.venv/bin/python scripts/sync_agentcore_jobs.py --runner <agentcore-bench-runner 路径>
```

同步脚本把同一个 agent + 模型 + effort 的多个批次（如 Fast30 和 Hard20）合并成一个 job，数据集记为 `tb2-50`。

## 看板

```bash
aae serve -p 8080                     # 默认只监听 127.0.0.1
aae serve -p 8080 --host 0.0.0.0      # 只在有访问控制的代理后面这样用
AAE_TASK_DIRS=<任务源码目录> aae serve   # 可选：任务详情里显示 instruction.md
```

- **Jobs 页**：每列可筛选（文字列多选，数字列填范围），可显示/隐藏列，排序和筛选会保存在浏览器里。Cost 旁边的 `*` 表示有 trial 没记录到用量，这部分成本没算进去。
- **Job 详情**：每个任务的结果、耗时、成本，点开看日志和 trial 文件。
- **Compare**：勾选 2 个以上 job，按任务对比，可只看结果不同的任务。
- **Score charts**：勾选 job 后点 Chart。两张图：分数对成本、分数对每任务平均耗时；同一 agent + 模型的 low → medium → high 连成一条线，悬停图例高亮单条线。

前端开发：`cd web && npm run dev`，Vite 会把 `/api` 代理到 `AAE_API_URL`（默认 `http://127.0.0.1:8080`）。

## 成本口径

- Claude Code / Codex：按 token 数乘 Bedrock 价格重新计算（价格表在 agentcore-bench-runner 的 `benchmarks/pricing.json`），不用 harness 自报的数字。Codex 的 input token 含缓存部分，入库前减掉缓存，和 Claude Code 口径一致。
- kiro-cli：只报 credit，按 $0.02/credit 换算。

## LLM Judge（可选）

Terminal-Bench 只给 pass/fail。`aae judge` 用 LLM 按 `rubrics/default.yaml` 的 5 个维度给 agent 输出打分，看失败任务"差在哪"：

```bash
aae judge <run-dir> --failed-only
```
