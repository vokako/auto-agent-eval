"""Agent Judge — LLM-based multi-dimension scoring."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import yaml

from aae.models import DimensionScore, JudgeResult

RUBRICS_DIR = Path(__file__).resolve().parent.parent / "rubrics"


def load_rubric(name: str = "default") -> dict:
    """Load a rubric YAML file."""
    path = RUBRICS_DIR / f"{name}.yaml"
    return yaml.safe_load(path.read_text())


def build_prompt(
    task_id: str,
    instruction: str,
    transcript: str,
    test_output: str,
    pytest_results: dict,
    rubric: dict,
) -> str:
    dims = rubric["dimensions"]
    rubric_text = ""
    for dim, spec in dims.items():
        anchors = spec.get("anchors", {})
        anchor_lines = "\n".join(f"      {k}: {v}" for k, v in anchors.items())
        rubric_text += (
            f"  {dim} ({spec['scale'][0]}-{spec['scale'][1]}): "
            f"{spec['description']}\n{anchor_lines}\n\n"
        )

    dim_json = ", ".join(
        f'"{d}": {{"score": <{s["scale"][0]}-{s["scale"][1]}>, "reason": "<1-2 sentences>"}}'
        for d, s in dims.items()
    )

    return f"""You are an expert evaluator reviewing an AI coding agent's work on a terminal-based task.

TASK: {task_id}
INSTRUCTION:
{instruction}

AGENT TRANSCRIPT (what the agent did):
{transcript[-8000:]}

TEST RESULTS:
{test_output[-3000:]}

PYTEST RESULTS: {json.dumps(pytest_results)}

RUBRIC — Score each dimension:
{rubric_text}

Respond in JSON only:
{{{dim_json}, "summary": "<2-3 sentence overall assessment>"}}"""


def call_llm(prompt: str, model: str = "claude-opus-4.6", retries: int = 2) -> dict:
    """Call kiro-cli as the judge LLM with retry and robust parsing."""
    for attempt in range(retries + 1):
        try:
            r = subprocess.run(
                ["kiro-cli-chat", "chat", "--no-interactive", "--trust-all-tools",
                 "--wrap", "never", "--model", model, prompt],
                capture_output=True, text=True, timeout=180,
            )
            clean = re.sub(r'\x1b\[[0-9;]*m', '', r.stdout)
            # Find the outermost JSON object
            depth = 0
            start = -1
            for i, c in enumerate(clean):
                if c == '{':
                    if depth == 0:
                        start = i
                    depth += 1
                elif c == '}':
                    depth -= 1
                    if depth == 0 and start >= 0:
                        try:
                            return json.loads(clean[start:i+1])
                        except json.JSONDecodeError:
                            break
        except subprocess.TimeoutExpired:
            pass
        except FileNotFoundError:
            return {"error": "kiro-cli-chat not found"}

        if attempt < retries:
            import time
            time.sleep(2)

    return {"error": f"Failed to parse judge response after {retries + 1} attempts"}


def judge_task(
    task_id: str,
    instruction: str,
    transcript: str,
    test_output: str,
    pytest_results: dict,
    model: str = "claude-opus-4.6",
    rubric_name: str = "default",
) -> JudgeResult | None:
    """Judge a single task and return structured result."""
    rubric = load_rubric(rubric_name)
    prompt = build_prompt(task_id, instruction, transcript, test_output, pytest_results, rubric)
    raw = call_llm(prompt, model)

    if "error" in raw:
        return None

    dimensions = {}
    for dim in rubric["dimensions"]:
        if dim in raw and isinstance(raw[dim], dict):
            dimensions[dim] = DimensionScore(
                score=raw[dim].get("score", 0),
                reason=raw[dim].get("reason", ""),
            )

    # Compute composite from dimension scores: average normalized to 0-1
    max_scale = max(s["scale"][1] for s in rubric["dimensions"].values())
    scores = [d.score for d in dimensions.values()]
    composite = sum(scores) / (len(scores) * max_scale) if scores else 0.0

    return JudgeResult(
        model=model,
        dimensions=dimensions,
        composite_score=round(composite, 3),
        summary=raw.get("summary", ""),
    )
