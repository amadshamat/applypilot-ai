/**
 * Published per-million-token prices (USD) for the models this build may use,
 * for cost estimates shown to the user. Unknown models report no estimate
 * rather than a guess.
 */
export const MODEL_PRICES: Readonly<Record<string, { input: number; output: number }>> = {
  'claude-opus-5-5': { input: 4, output: 20 },
};

export const DEFAULT_MODEL = 'claude-opus-5-5';

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  const cost = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return Math.round(cost * 10_000) / 10_000;
}

/** Rough token count for text (about four characters per token in English). */
export function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Upper-bound cost of one request before it is sent: the whole prompt as
 * input plus the task's full output ceiling. Real requests usually cost less.
 */
export function worstCaseCostUsd(
  model: string,
  promptChars: number,
  maxTokens: number,
): number | null {
  return estimateCostUsd(model, Math.ceil(promptChars / 4), maxTokens);
}

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00';
  if (amount < 0.01) return '< $0.01';
  return `$${amount.toFixed(2)}`;
}
