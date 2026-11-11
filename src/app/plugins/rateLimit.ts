import type { RateLimitPluginOptions } from "@fastify/rate-limit";

/**
 * @module plugins/rateLimit
 * Shared settings for the `@fastify/rate-limit` plugin, keyed by client IP (`request.ip`).
 * Behind a reverse proxy, configure TRUST_PROXY so `request.ip` is the real client address.
 * State is per process: with N replicas the effective limit per client is up to N times the configured max.
 */

/** Default maximum requests per window. */
export const DEFAULT_RATE_LIMIT_MAX = 1000;
/** Default window length in milliseconds. */
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

/** Upper bound of tracked clients held in the plugin's in-memory store. */
export const MAX_TRACKED_CLIENTS = 10_000;

/** Limiter tuning passed to the routes. */
export interface RateLimitSettings {
  /** Maximum requests allowed per client within one window; `0` disables limiting. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** Body sent with a 429 response. */
export interface RateLimitErrorBody {
  statusCode: 429;
  message: string;
  retryAfterSeconds: number;
}

/** Builds the 429 body, shaped like the other error bodies of the service (`message` plus a retry hint). */
export function buildRateLimitErrorBody(_request: unknown, context: { after: string; ttl: number }): RateLimitErrorBody {
  return {
    statusCode: 429,
    message: "Too many requests",
    retryAfterSeconds: Math.max(1, Math.ceil(context.ttl / 1000)),
  };
}

/** Plugin options shared by every route group that registers the limiter (`max <= 0` must not be registered). */
export function rateLimitOptions(max: number, windowMs: number): RateLimitPluginOptions {
  return {
    global: true,
    max,
    timeWindow: windowMs,
    cache: MAX_TRACKED_CLIENTS,
    errorResponseBuilder: buildRateLimitErrorBody,
  };
}
