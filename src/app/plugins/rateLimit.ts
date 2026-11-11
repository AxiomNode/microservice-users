import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * @module plugins/rateLimit
 * Small in-memory fixed-window rate limiter keyed by client IP (`request.ip`).
 * Behind a reverse proxy, configure TRUST_PROXY so `request.ip` is the real client address.
 * State is per process: with N replicas the effective limit per client is up to N times the configured max.
 */

/** Rate limiter tuning. `max <= 0` disables limiting. */
export interface RateLimitOptions {
  /** Maximum requests allowed per client within one window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Upper bound of tracked clients; the oldest entries are evicted beyond it. */
  maxTrackedClients?: number;
  /** Clock override, used by tests. */
  now?: () => number;
}

/**
 * Default maximum requests per window. Deliberately generous: this service sits behind the BFFs, which do not
 * forward the end-user address, so every end user shares the bucket of the calling BFF pod unless the caller
 * forwards X-Forwarded-For and TRUST_PROXY is set accordingly.
 */
export const DEFAULT_RATE_LIMIT_MAX = 1000;
/** Default window length in milliseconds. */
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

const DEFAULT_MAX_TRACKED_CLIENTS = 10_000;

interface Bucket {
  count: number;
  resetAt: number;
}

/** Creates a Fastify `preHandler` hook that answers 429 once a client exceeds the configured budget. */
export function createRateLimiter(options: RateLimitOptions) {
  const { max, windowMs } = options;
  const maxTracked = options.maxTrackedClients ?? DEFAULT_MAX_TRACKED_CLIENTS;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();
  let nextSweepAt = 0;

  function sweep(current: number) {
    if (current < nextSweepAt && buckets.size < maxTracked) {
      return;
    }
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= current) {
        buckets.delete(key);
      }
    }
    while (buckets.size >= maxTracked) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      buckets.delete(oldest);
    }
    nextSweepAt = current + windowMs;
  }

  return async function rateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (max <= 0) {
      return;
    }

    const current = now();
    sweep(current);

    const key = request.ip;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= current) {
      bucket = { count: 0, resetAt: current + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - current) / 1000));
    reply.header("x-ratelimit-limit", max);
    reply.header("x-ratelimit-remaining", remaining);
    reply.header("x-ratelimit-reset", resetSeconds);

    if (bucket.count > max) {
      reply.header("retry-after", resetSeconds);
      return reply.status(429).send({
        message: "Too many requests",
        retryAfterSeconds: resetSeconds,
      });
    }
  };
}
