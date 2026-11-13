// fetch com retry e backoff exponencial (429, 5xx e falhas de rede).

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
    public url: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function backoffDelay(attempt: number, base: number, max: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, max);
  }
  const exp = base * 2 ** attempt;
  const jitter = Math.random() * base;
  return Math.min(exp + jitter, max);
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status <= 599);
}

/** Remove querystring sensível de URLs antes de usá-las em mensagens/logs. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of ["access_token", "client_secret", "code", "refresh_token"]) {
      if (u.searchParams.has(k)) u.searchParams.set(k, "***");
    }
    return u.toString();
  } catch {
    return url;
  }
}

export async function fetchJson<T = unknown>(url: string, init: RequestInit = {}, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 8000;
  const sleep = opts.sleep ?? defaultSleep;
  const doFetch = opts.fetchImpl ?? fetch;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(20000) });
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(backoffDelay(attempt, base, max));
        continue;
      }
      throw err;
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* corpo não-JSON */
    }
    if (res.ok) return body as T;
    if (isRetryable(res.status) && attempt < retries) {
      await sleep(backoffDelay(attempt, base, max, res.headers.get("retry-after")));
      continue;
    }
    const msg =
      (body && typeof body === "object" && ("message" in body || "error" in body)
        ? String((body as Record<string, unknown>).message ?? (body as Record<string, unknown>).error)
        : `HTTP ${res.status}`) || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, body, redactUrl(url));
  }
  throw lastErr instanceof Error ? lastErr : new Error("Falha de rede");
}
