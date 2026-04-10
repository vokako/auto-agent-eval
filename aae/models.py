"""Data models for AAE evaluation results."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class DimensionScore:
    score: int
    reason: str


@dataclass
class JudgeResult:
    model: str
    dimensions: dict[str, DimensionScore]
    composite_score: float
    summary: str


@dataclass
class RuleCheckResult:
    name: str
    passed: bool
    score: float
    reason: str = ""


@dataclass
class RulesResult:
    score: float
    checks: list[RuleCheckResult]


@dataclass
class PytestResult:
    is_resolved: bool
    score: float
    results: dict[str, str]


@dataclass
class CompositeResult:
    score: float
    weights: dict[str, float]
    breakdown: dict[str, float]


@dataclass
class TaskEvalResult:
    task_id: str
    pytest: PytestResult
    rules: RulesResult | None = None
    judge: JudgeResult | None = None
    composite: CompositeResult | None = None


@dataclass
class RunEvalResult:
    run_id: str
    model: str
    tasks: list[TaskEvalResult] = field(default_factory=list)

    @property
    def n_tasks(self) -> int:
        return len(self.tasks)

    @property
    def pytest_resolved(self) -> int:
        return sum(1 for t in self.tasks if t.pytest.is_resolved)

    @property
    def avg_composite(self) -> float:
        scores = [t.composite.score for t in self.tasks if t.composite]
        return sum(scores) / len(scores) if scores else 0.0
