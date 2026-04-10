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

### 第一步：跑 Terminal-Bench

```bash
pip install terminal-bench

# 跑单个任务
tb run \
    --agent-import-path agents.kiro_cli.kiro_cli_agent:KiroCliAgent \
    --dataset-path ./datasets/terminal-bench-core \
    --task-id hello-world \
    --model claude-sonnet-4.6

# 跑全部 80 个任务
tb run \
    --agent-import-path agents.kiro_cli.kiro_cli_agent:KiroCliAgent \
    --dataset-path ./datasets/terminal-bench-core \
    --model claude-sonnet-4.6 \
    --n-concurrent 4
```

结果保存在 `runs/{run-id}/`，每个任务有 pytest 结果 + agent 终端输出。

### 或者用 task 配置一键跑（推荐）

```bash
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
