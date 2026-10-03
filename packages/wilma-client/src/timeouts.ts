/*
 * Idle timeouts for requests and downloads. A request fails when the server
 * stops answering for a while — before the response, or while the body is
 * read — not after a fixed total, so a large attachment on a slow connection
 * still finishes while a stalled one doesn't hang forever.
 */
import { Response } from "undici";
import { NetworkError, wrapNetworkError } from "./network-error.js";

/** An abort signal that fires after `ms` without progress. */
export class IdleTimer {
  private readonly controller = new AbortController();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly ms: number) {
    this.touch();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Progress: start the wait over. */
  touch(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.controller.abort(new DOMException("The server stopped answering", "TimeoutError")),
      this.ms
    );
    // A response nobody reads must not keep the process alive.
    this.timer.unref?.();
  }

  stop(): void {
    clearTimeout(this.timer);
  }
}

/** A timeout or broken connection as a NetworkError; anything else unchanged. */
export function asNetworkError(err: unknown, origin: string): unknown {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return new NetworkError(`${origin} didn't answer in time`, { code: "TIMEOUT", origin, cause: err });
  }
  return wrapNetworkError(err, origin);
}

// Statuses whose responses can't carry a body.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * The same response, with its body read under the idle timer: each chunk
 * restarts the wait, and a stall or broken connection while reading surfaces
 * as a NetworkError, like one before the response.
 */
export function watchBody(response: Response, idle: IdleTimer, origin: string): Response {
  if (!response.body || NULL_BODY_STATUSES.has(response.status)) {
    idle.stop();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          idle.stop();
          controller.close();
          return;
        }
        idle.touch();
        controller.enqueue(value);
      } catch (err) {
        idle.stop();
        controller.error(asNetworkError(err, origin));
      }
    },
    cancel(reason) {
      idle.stop();
      return reader.cancel(reason);
    },
  });
  const watched = new Response(body as never, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  // Parsers resolve links against the final address.
  Object.defineProperty(watched, "url", { value: response.url });
  return watched;
}
