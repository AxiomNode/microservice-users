import { describe, expect, it } from "vitest";

import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";

import {
  buildRateLimitErrorBody,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  rateLimitOptions,
} from "../app/plugins/rateLimit.js";
import { parseTrustProxy } from "../app/plugins/trustProxy.js";

async function buildApp(max: number, windowMs: number, trustProxy = "false") {
  const app = Fastify({ trustProxy: parseTrustProxy(trustProxy) });
  app.get("/open", async () => ({ ok: true }));
  await app.register(rateLimit, rateLimitOptions(max, windowMs));
  app.get("/limited", async () => ({ ok: true }));
  return app;
}

function hit(app: Awaited<ReturnType<typeof buildApp>>, remoteAddress: string, headers: Record<string, string> = {}) {
  return app.inject({ method: "GET", url: "/limited", remoteAddress, headers });
}

describe("rate limit options", () => {
  it("documents the defaults", () => {
    expect(DEFAULT_RATE_LIMIT_MAX).toBe(1000);
    expect(DEFAULT_RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });

  it("builds a 429 body with a retry hint of at least one second", () => {
    expect(buildRateLimitErrorBody({}, { after: "1 minute", ttl: 60_000 })).toEqual({
      statusCode: 429,
      message: "Too many requests",
      retryAfterSeconds: 60,
    });
    expect(buildRateLimitErrorBody({}, { after: "1 second", ttl: 100 }).retryAfterSeconds).toBe(1);
  });
});

describe("@fastify/rate-limit with the shared options", () => {
  it("allows up to max requests then answers 429 with retry headers", async () => {
    const app = await buildApp(2, 60_000);

    const first = await hit(app, "10.0.0.1");
    expect(first.statusCode).toBe(200);
    expect(first.headers["x-ratelimit-limit"]).toBe("2");
    expect(first.headers["x-ratelimit-remaining"]).toBe("1");

    const second = await hit(app, "10.0.0.1");
    expect(second.statusCode).toBe(200);
    expect(second.headers["x-ratelimit-remaining"]).toBe("0");

    const third = await hit(app, "10.0.0.1");
    expect(third.statusCode).toBe(429);
    expect(Number(third.headers["retry-after"])).toBeGreaterThan(0);
    expect(third.headers["x-ratelimit-remaining"]).toBe("0");
    expect(third.json()).toEqual({
      statusCode: 429,
      message: "Too many requests",
      retryAfterSeconds: Number(third.headers["retry-after"]),
    });
    await app.close();
  });

  it("keeps separate budgets per client IP", async () => {
    const app = await buildApp(1, 60_000);

    expect((await hit(app, "10.0.0.1")).statusCode).toBe(200);
    expect((await hit(app, "10.0.0.1")).statusCode).toBe(429);
    expect((await hit(app, "10.0.0.2")).statusCode).toBe(200);
    await app.close();
  });

  it("resets the budget once the window has elapsed", async () => {
    const app = await buildApp(1, 100);

    expect((await hit(app, "10.0.0.1")).statusCode).toBe(200);
    expect((await hit(app, "10.0.0.1")).statusCode).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect((await hit(app, "10.0.0.1")).statusCode).toBe(200);
    await app.close();
  });

  it("leaves routes defined before the registration untouched", async () => {
    const app = await buildApp(1, 60_000);

    await hit(app, "10.0.0.1");
    await hit(app, "10.0.0.1");
    for (let i = 0; i < 3; i += 1) {
      const response = await app.inject({ method: "GET", url: "/open", remoteAddress: "10.0.0.1" });
      expect(response.statusCode).toBe(200);
    }
    await app.close();
  });

  it("shares one bucket behind a proxy when TRUST_PROXY is false", async () => {
    const app = await buildApp(1, 60_000, "false");

    expect((await hit(app, "10.9.9.9", { "x-forwarded-for": "203.0.113.1" })).statusCode).toBe(200);
    expect((await hit(app, "10.9.9.9", { "x-forwarded-for": "203.0.113.2" })).statusCode).toBe(429);
    await app.close();
  });

  it("separates clients behind a trusted proxy and ignores spoofing from untrusted peers", async () => {
    const app = await buildApp(1, 60_000, "10.0.0.0/8");

    expect((await hit(app, "10.9.9.9", { "x-forwarded-for": "203.0.113.1" })).statusCode).toBe(200);
    expect((await hit(app, "10.9.9.9", { "x-forwarded-for": "203.0.113.2" })).statusCode).toBe(200);
    expect((await hit(app, "10.9.9.9", { "x-forwarded-for": "203.0.113.1" })).statusCode).toBe(429);

    // A direct, untrusted peer cannot choose its own bucket through the header.
    expect((await hit(app, "198.51.100.5", { "x-forwarded-for": "203.0.113.50" })).statusCode).toBe(200);
    expect((await hit(app, "198.51.100.5", { "x-forwarded-for": "203.0.113.51" })).statusCode).toBe(429);
    await app.close();
  });
});
