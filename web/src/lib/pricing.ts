// Credit unit prices used to convert vendor credits to USD. Mirrors the "*-credit" entries of
// agentcore-bench-runner benchmarks/pricing.json, which is what the converter actually applies.
export const FX_CNY_PER_USD = 6.7;

export const CREDIT_PRICES = [
  { agent: "kiro-cli", label: "Kiro", price: "$0.02 / credit", note: "plan-included rate ($20 per 1,000)" },
  { agent: "qoder-cn", label: "Qoder CN", price: "¥0.04 / credit", note: "¥80 per 2,000" },
  { agent: "codebuddy", label: "CodeBuddy CN", price: "¥0.0495 / credit", note: "Standard plan ¥99 per 2,000 base credits" },
];

export const CREDIT_PRICE_NOTE =
  "Credit prices: " + CREDIT_PRICES.map(p => `${p.label} ${p.price} (${p.note})`).join("; ") +
  `. CNY converted at ${FX_CNY_PER_USD} CNY/USD. Token-billed agents (Claude Code, Codex, Kimi Code) use Bedrock list prices.`;
