# Agent Eval

用 [Terminal-Bench 2.0](https://www.tbench.ai/) 跑 AI coding agent，然后用 LLM Judge 做增强评估。

Terminal-Bench 只给 pass/fail，我们加了 LLM 打分，能看出 agent "差在哪" 和 "做得多好"。

## 项目结构

```
agent-eval/
│
├── datasets/                    # Terminal-Bench 任务集（80 个任务，已固定）
│   └── terminal-bench-core/     #   Terminal-Bench 2.0 core dataset
│       ├── hello-world/         #     每个任务 = Dockerfile + 指令 + pytest
│       ├── build-linux-kernel-qemu/
│       └── ... (80 个)
│
├── agents/kiro_cli/             # Kiro CLI 的 Terminal-Bench 适配器
│   ├── kiro_cli_agent.py        #   怎么在 Docker 容器里装和跑 kiro-cli
│   ├── setup.sh.j2              #   容器内安装脚本模板
│   └── agent.yaml               #   配置（region、timeout）
│
├── tasks/                       # 测试任务定义（dataset + agent + 评估 的组合）
│   ├── kiro-sonnet-tb-core.yaml #   kiro-cli + sonnet-4.6 跑 TB 全部任务
│   ├── kiro-glm5-tb-core.yaml   #   kiro-cli + glm-5
│   ├── kiro-minimax-tb-core.yaml
│   └── kiro-qwen-tb-core.yaml
│
├── aae/                         # 增强评估工具（跑完 TB 后用）
│   ├── judge.py                 #   LLM Judge — 读 agent 输出，5 维度打分
│   ├── rules.py                 #   规则检查 — 确定性验证（文件存在、命令输出）
│   ├── composite.py             #   综合评分 — pytest + rules + judge 加权
│   ├── tb.py                    #   读取 Terminal-Bench 的输出文件
│   ├── models.py                #   数据模型
│   └── cli.py                   #   命令行入口
│
├── rubrics/default.yaml         # Judge 评分标准（5 维度 0-3 分）
│
├── runs/                        # 测试结果（git ignored）
│
├── SPEC.md                      # 设计文档
└── pyproject.toml
```

## 怎么用

### 用 Harbor 跑（推荐）

```bash
pip install harbor

# CC + Sonnet 4.6 via Bedrock
harbor run -d terminal-bench/terminal-bench-2 -a claude-code \
    -m global.anthropic.claude-sonnet-4-6 \
    --ae CLAUDE_CODE_USE_BEDROCK=1 --ae AWS_REGION=us-east-1 \
    -n 4

# Kiro CLI
harbor run -d terminal-bench/terminal-bench-2 \
    --agent-import-path agents.kiro_cli.harbor_agent:KiroCliAgent \
    -m claude-sonnet-4.6 -n 4

# Qoder CLI
harbor run -d terminal-bench/terminal-bench-2 \
    --agent-import-path agents.qoder_cli.harbor_agent:QoderCliAgent \
    -m lite --ae QODER_PERSONAL_ACCESS_TOKEN=$QODER_PERSONAL_ACCESS_TOKEN -n 4
```

### 用 AAE 跑（TB legacy + judge）

```bash
uv sync

# 列出可用的 task
aae list

# 跑一个 task（自动 tb run + judge）
aae run kiro-sonnet-tb-core

# 只跑 tb，不做 judge
aae run kiro-sonnet-tb-core --no-judge
```

### 第二步：增强评估

```bash
# 对失败的任务做 LLM Judge 评估
aae judge runs/{run-id}/ --failed-only

# 对所有任务评估
aae judge runs/{run-id}/ --all

# 对比多个模型
aae compare runs/kiro-sonnet-*/ runs/kiro-glm-*/
```

### 输出示例

```
nginx-request-logging:
  pytest:  FAIL (7/8 tests passed)
  judge:   0.73 — "功能完全正确，log_format 放在 conf.d 而不是 nginx.conf"
  composite: 0.37

build-linux-kernel-qemu:
  pytest:  FAIL (timeout)
  judge:   0.95 — "内核编译成功，只是超时了"
  composite: 0.48
```

## 关键概念

- **datasets/** — Terminal-Bench 的任务，每个任务有 Dockerfile（运行环境）、instruction（给 agent 的指令）、pytest（验证）
- **agents/kiro_cli/** — 告诉 Terminal-Bench 怎么在 Docker 容器里安装和运行 kiro-cli
- **tasks/** — 测试任务定义，一个 YAML 文件 = dataset + agent + model + 评估配置
- **aae/** — 跑完 Terminal-Bench 后的增强评估，读结果文件做 LLM 打分
- **rubrics/** — LLM Judge 的评分标准，定义打哪几个维度、每个维度怎么打分
