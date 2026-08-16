const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response, attempt, baseDelayMs) {
  const retryAfter = response?.headers?.get?.("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }

  return baseDelayMs * 2 ** attempt;
}

function discardResponse(response) {
  if (typeof response?.body?.destroy === "function") response.body.destroy();
}

/**
 * Fetch with a per-attempt timeout and bounded retries for transient failures.
 * Callers still decide whether retrying a particular HTTP method is acceptable.
 */
export async function fetchWithRetry(
  url,
  options = {},
  {
    attempts = 3,
    timeoutMs = 15_000,
    baseDelayMs = 500,
    fetchImpl = globalThis.fetch,
    retryableStatuses = RETRYABLE_STATUS_CODES,
    wait = sleep,
  } = {}
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("No Fetch API implementation is available");
  }

  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: controller.signal,
      });

      if (!retryableStatuses.has(response.status) || attempt === attempts - 1) {
        return response;
      }

      discardResponse(response);
      await wait(retryDelay(response, attempt, baseDelayMs));
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
      await wait(baseDelayMs * 2 ** attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("Request failed without a response");
}

/** Retry an arbitrary asynchronous operation, such as RSS parsing. */
export async function withRetry(
  operation,
  { attempts = 3, baseDelayMs = 500, wait = sleep } = {}
) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
      await wait(baseDelayMs * 2 ** attempt);
    }
  }

  throw lastError;
}
