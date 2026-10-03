// Failed Wilma logins through the relay, per username and per client IP.
// In-memory, so per server instance: it slows guessing without a database.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map<string, { count: number; first: number }>();

function prune(now: number) {
  for (const [key, entry] of failures) if (now - entry.first > WINDOW_MS) failures.delete(key);
}

export function attemptKeys(req: Request, username: string): string[] {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  return [`user:${username.trim().toLowerCase()}`, `ip:${ip}`];
}

export function tooManyAttempts(keys: string[]): boolean {
  const now = Date.now();
  prune(now);
  return keys.some((key) => (failures.get(key)?.count ?? 0) >= MAX_FAILURES);
}

export function recordFailure(keys: string[]): void {
  const now = Date.now();
  for (const key of keys) {
    const entry = failures.get(key);
    if (entry) entry.count += 1;
    else failures.set(key, { count: 1, first: now });
  }
}

export function clearFailures(keys: string[]): void {
  for (const key of keys) failures.delete(key);
}
