import { isIP } from "node:net";

/**
 * @module plugins/trustProxy
 * Parses the TRUST_PROXY environment value into the shape Fastify expects for its `trustProxy` option.
 */

/** Value accepted by Fastify's `trustProxy` option. */
export type TrustProxySetting = boolean | string[] | ((address: string, hop: number) => boolean);

const NAMED_RANGES = new Set(["loopback", "linklocal", "uniquelocal"]);

function isValidEntry(entry: string): boolean {
  if (NAMED_RANGES.has(entry)) {
    return true;
  }

  const [address, prefix, ...rest] = entry.split("/");
  if (rest.length > 0) {
    return false;
  }

  const family = isIP(address ?? "");
  if (family === 0) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }
  if (!/^\d{1,3}$/.test(prefix)) {
    return false;
  }
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Converts the raw TRUST_PROXY string into a Fastify `trustProxy` value.
 *
 * - empty, `false` or `0` -> `false` (default: ignore X-Forwarded-For, use the socket address)
 * - `true` -> `true` (trust every hop; only safe if the pod is unreachable except through the proxy)
 * - a positive integer N -> trust the N proxy hops closest to this service (N must match the real proxy chain, otherwise
 *   clients can spoof their address). Fastify fails closed on a bare numeric `trustProxy`, so this is returned as a
 *   hop predicate instead of a number.
 * - a comma-separated list of IPs, CIDR ranges or `loopback`/`linklocal`/`uniquelocal` -> trusted proxies
 *
 * Throws when the value is not one of the supported forms.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = (raw ?? "").trim();
  const lowered = value.toLowerCase();

  if (lowered === "" || lowered === "false") {
    return false;
  }
  if (lowered === "true") {
    return true;
  }
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (!Number.isSafeInteger(hops)) {
      throw new Error(`Invalid TRUST_PROXY hop count: ${value}`);
    }
    return hops === 0 ? false : (_address, hop) => hop < hops;
  }

  const entries = value.split(",").map((entry) => entry.trim().toLowerCase());
  const invalid = entries.find((entry) => entry === "" || !isValidEntry(entry));
  if (invalid !== undefined) {
    throw new Error(
      `Invalid TRUST_PROXY entry "${invalid}": expected true/false, a hop count, or a comma-separated list of IPs/CIDRs`,
    );
  }
  return entries;
}
