import { describe, expect, it } from "vitest";

import Fastify from "fastify";

import { createRateLimiter, RateLimitOptions } from "../app/plugins/rateLimit.js";
import { parseTrustProxy } from "../app/plugins/trustProxy.js";

async function buildApp(options: RateLimitOptions, trustProxy = "false") {
  const app = Fastify({ trustProxy: parseTrustProxy(trustProxy) });
  app.get("/limited", { onRequest: createRateLimiter(options) }, async () => ({ ok: true }));
  app.get("/open", async () => ({ ok: true }));
  return app;
}

function hit(app: Awaited<ReturnType<typeof buildApp>>, remoteAddress: string, headers: Record<string, string> = {}) {
  return app.inject({ method: "GET", url: "/limited", remoteAddress, headers });
}

describe("createRateLimiter", () => {
  it("allows up to max requests then answers 429 with retry headers", async () => {
    const app = await buildApp({ max: 2, windowMs: 60_000, now: () => 1_000 });

    const first = await hit(app, "10.0.0.1");
    expect(first.statusCode).toBe(200);
    expect(first.headers["x-ratelimit-limit"]).toBe("2");
    expect(first.headers["x-ratelimit-remaining"]).toBe("1");

    const second = await hit(app, "10.0.0.1");
    expect(second.statusCode).toBe(200);
    expect(second.headers["x-ratelimit-remaining"]).toBe("0");

    const third = await hit(app, "10.0.0.1");
    expect(third.statusCode).toBe(429);
    expect(third.headers["retry-after"]).toBe("60");
    expect(third.headers["x-ratelimit-remaining"]).toBe("0");
    expect(third.json()).toEqual({ message: "Too many requests", retryAfterSeconds: 60 });
    await app.close();
  });

  it("keeps separate budgets per client IP", async () => {
    const app = await buildApp({ max: 1, windowMs: 60_000, now: () => 1_000 });

    expect((await hit(app, "10.0.0.1")).statusCode).toBe(200);
    expect((await hit(app, "10.0.0.1")).statusCode).toBe(429);
    expect((await hit(app, "10.0.0.2")).statusCode).toBe(200);
    await app.close();
  });

  it("resets the budget once the window has elapsed", async () => {
    let clock = 1_000;
    const app = await buildApp({ max: 1, windowMs: 10_000, now: () => clock });

    expect((await hit(app, "10.0.0.1")).statusCode).toBe(200);
    clock += 4_500;
    const blocked = await hit(app, "10.0.0.1");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("6");

    clock += 6_000;
    expect((await hit(app, "10.0.0.1")).statusCode).toBe(200);
    await app.close();
  });

  it("does nothing when max is 0", async () => {
    const app = await buildApp({ max: 0, windowMs: 60_000 });

    for (let i = 0; i < 5; i += 1) {
      const response = await hit(app, "10.0.0.1");
      expect(response.statusCode).toBe(200);
      expect(response.headers["x-ratelimit-limit"]).toBeUndefined();
    }
    await app.close();
  });

  it("leaves routes without the limiter untouched", async () => {
    const app = await buildApp({ max: 1, windowMs: 60_000, now: () => 1_000 });

    await hit(app, "10.0.0.1");
    await hit(app, "10.0.0.1");
    for (let i = 0; i < 3; i += 1) {
      const response = await app.inject({ method: "GET", url: "/open", remoteAddress: "10.0.0.1" });
      expect(response.statusCode).toBe(200);
    }
    await app.close();
  });

  it("evicts the oldest clients beyond maxTrackedClients and drops expired ones", async () => {
    let clock = 1_000;
    const app = await buildApp({ max: 1, windowMs: 10_000, maxTrackedClients: 2, now: () => clock });

    expect((await hit(app, "10.0.0.1")).statusCode).toBe(200);
    expect((await hit(app, "10.0.0.2")).statusCode).toBe(200);
    // Third client evicts the oldest (10.0.0.1), which therefore gets a fresh budget.
    expect((await hit(app, "10.0.0.3")).statusCode).toBe(200);
    expect((await hit(app, "10.0.0.1")).statusCode).toBe(200);

    clock += 20_000;
    expect((await hit(app, "10.0.0.3")).statusCode).toBe(200);
    await app.close();
  });

  it("shares one bucket behind a proxy when TRUST_PROXY is false", async () => {
    const app = await buildApp({ max: 1, windowMs: 60_000, now: () => 1_000 }, "false");

    expect((await hit(app, "10.9.9.9", { "x-forwarded-for": "203.0.113.1" })).statusCode).toBe(200);
    expect((await hit(app, "10.9.9.9", { "x-forwarded-for": "203.0.113.2" })).statusCode).toBe(429);
    await app.close();
  });

  it("separates clients behind a trusted proxy and ignores spoofing from untrusted peers", async () => {
    const app = await buildApp({ max: 1, windowMs: 60_000, now: () => 1_000 }, "10.0.0.0/8");

    expect((await hit(app, "10.9.9.9", { "x-forwarded-for": "203.0.113.1" })).statusCode).toBe(200);
    expect((await hit(app, "10.9.9.9", { "x-forwarded-for": "203.0.113.2" })).statusCode).toBe(200);
    expect((await hit(app, "10.9.9.9", { "x-forwarded-for": "203.0.113.1" })).statusCode).toBe(429);

    // A direct, untrusted peer cannot choose its own bucket through the header.
    expect((await hit(app, "198.51.100.5", { "x-forwarded-for": "203.0.113.50" })).statusCode).toBe(200);
    expect((await hit(app, "198.51.100.5", { "x-forwarded-for": "203.0.113.51" })).statusCode).toBe(429);
    await app.close();
  });
});
