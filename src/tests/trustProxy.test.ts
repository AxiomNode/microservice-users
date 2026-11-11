import { describe, expect, it } from "vitest";

import Fastify from "fastify";

import { parseTrustProxy } from "../app/plugins/trustProxy.js";

describe("parseTrustProxy", () => {
  it("defaults to false for unset, empty, false and 0", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("   ")).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("FALSE")).toBe(false);
    expect(parseTrustProxy("0")).toBe(false);
  });

  it("accepts true", () => {
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy(" True ")).toBe(true);
  });

  it("accepts a hop count", () => {
    const one = parseTrustProxy("1") as (address: string, hop: number) => boolean;
    expect(one("10.0.0.1", 0)).toBe(true);
    expect(one("203.0.113.7", 1)).toBe(false);
    const two = parseTrustProxy(" 2 ") as (address: string, hop: number) => boolean;
    expect(two("10.0.0.1", 1)).toBe(true);
    expect(two("203.0.113.7", 2)).toBe(false);
  });

  it("rejects an unsafe hop count", () => {
    expect(() => parseTrustProxy("99999999999999999999")).toThrow(/hop count/);
  });

  it("accepts comma-separated IPs, CIDRs and named ranges", () => {
    expect(parseTrustProxy("10.0.0.0/8, 192.168.1.5,::1,fd00::/8,Loopback")).toEqual([
      "10.0.0.0/8",
      "192.168.1.5",
      "::1",
      "fd00::/8",
      "loopback",
    ]);
  });

  it.each(["nope", "10.0.0.0/33", "fd00::/129", "10.0.0.0/abc", "10.0.0.1/8/8", "10.0.0.1,", "999.1.1.1", "true,1"])(
    "rejects invalid value %s",
    (value) => {
      expect(() => parseTrustProxy(value)).toThrow(/TRUST_PROXY/);
    },
  );

  it("makes Fastify use X-Forwarded-For only when the peer is trusted", async () => {
    async function ipFor(setting: string, remoteAddress: string) {
      const app = Fastify({ trustProxy: parseTrustProxy(setting) });
      app.get("/ip", async (request) => ({ ip: request.ip }));
      const response = await app.inject({
        method: "GET",
        url: "/ip",
        remoteAddress,
        headers: { "x-forwarded-for": "203.0.113.7" },
      });
      await app.close();
      return response.json<{ ip: string }>().ip;
    }

    expect(await ipFor("false", "10.1.2.3")).toBe("10.1.2.3");
    expect(await ipFor("1", "10.1.2.3")).toBe("203.0.113.7");
    expect(await ipFor("true", "10.1.2.3")).toBe("203.0.113.7");
    expect(await ipFor("2", "10.1.2.3")).toBe("203.0.113.7");
    expect(await ipFor("10.0.0.0/8", "10.1.2.3")).toBe("203.0.113.7");
    expect(await ipFor("10.0.0.0/8", "198.51.100.9")).toBe("198.51.100.9");
  });
});
