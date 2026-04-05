const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type WithRetryOptions = {
  retries: number;
  baseDelayMs: number;
  onRetry?: (attempt: number, error: unknown) => void;
};

const defaultOptions: WithRetryOptions = {
  retries: 3,
  baseDelayMs: 250,
};

/**
 * Retries when the wrapped function throws. Does not retry on resolved values.
 * Use for transient network / transport failures.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<WithRetryOptions> = {},
): Promise<T> {
  const { retries, baseDelayMs, onRetry } = { ...defaultOptions, ...options };
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt >= retries) break;
      onRetry?.(attempt + 1, e);
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }
  throw lastError;
}
