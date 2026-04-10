"""Composite scoring — combine pytest + rules + judge."""

from __future__ import annotations

from aae.models import (
    CompositeResult, JudgeResult, PytestResult, RulesResult,
)

DEFAULT_WEIGHTS = {"pytest": 0.5, "judge": 0.5}
DEFAULT_WEIGHTS_WITH_RULES = {"pytest": 0.4, "rules": 0.3, "judge": 0.3}


def compute_composite(
    pytest: PytestResult,
    rules: RulesResult | None = None,
    judge: JudgeResult | None = None,
    weights: dict[str, float] | None = None,
) -> CompositeResult:
    """Compute weighted composite score."""
    if weights is None:
        weights = DEFAULT_WEIGHTS_WITH_RULES if rules else DEFAULT_WEIGHTS

    breakdown = {"pytest": pytest.score}
    if rules:
        breakdown["rules"] = rules.score
    if judge:
        breakdown["judge"] = judge.composite_score

    # Only use weights for signals we actually have
    active_weights = {k: v for k, v in weights.items() if k in breakdown}
    total_weight = sum(active_weights.values())
    if total_weight == 0:
        return CompositeResult(score=0.0, weights=weights, breakdown=breakdown)

    score = sum(breakdown[k] * active_weights[k] for k in active_weights) / total_weight

    return CompositeResult(score=score, weights=weights, breakdown=breakdown)
