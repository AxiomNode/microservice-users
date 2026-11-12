import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../app/config.js";

const originalEnv = { ...process.env };

function withEnv(overrides: Record<string, string | undefined>) {
  process.env = { ...originalEnv, ...overrides };
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("loadConfig", () => {
  it("fails when strict Firebase auth is enabled without credentials", () => {
    withEnv({
      SERVICE_NAME: "microservice-users",
      SERVICE_PORT: "7100",
      NODE_ENV: "test",
      METRICS_LOG_BUFFER_SIZE: "500",
      DATABASE_URL: "postgresql://users:users@localhost:7434/usersdb?schema=public",
      PRIVATE_DOCS_ENABLED: "false",
      FIREBASE_STRICT_AUTH: "true",
      FIREBASE_PROJECT_ID: "",
      FIREBASE_CLIENT_EMAIL: "",
      FIREBASE_PRIVATE_KEY: "",
      FIREBASE_CREDENTIALS_JSON: ""
    });

    expect(() => loadConfig()).toThrow("Invalid environment configuration for microservice-users");
  });

  it("accepts strict Firebase auth when credentials json is valid", () => {
    withEnv({
      SERVICE_NAME: "microservice-users",
      SERVICE_PORT: "7100",
      NODE_ENV: "test",
      METRICS_LOG_BUFFER_SIZE: "500",
      DATABASE_URL: "postgresql://users:users@localhost:7434/usersdb?schema=public",
      PRIVATE_DOCS_ENABLED: "false",
      FIREBASE_STRICT_AUTH: "true",
      FIREBASE_CREDENTIALS_JSON:
        '{"project_id":"project-x","client_email":"x@test.dev","private_key":"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"}',
      FIREBASE_PROJECT_ID: "",
      FIREBASE_CLIENT_EMAIL: "",
      FIREBASE_PRIVATE_KEY: ""
    });

    const config = loadConfig();
    expect(config.FIREBASE_STRICT_AUTH).toBe(true);
    expect(config.FIREBASE_CREDENTIALS_JSON).toContain("project_id");
  });

  it("accepts strict auth when the credential triplet is present and private docs are configured", () => {
    withEnv({
      DATABASE_URL: "postgresql://users:users@localhost:7434/usersdb?schema=public",
      FIREBASE_STRICT_AUTH: "yes",
      FIREBASE_PROJECT_ID: "project-triplet",
      FIREBASE_CLIENT_EMAIL: "triplet@test.dev",
      FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
      FIREBASE_CREDENTIALS_JSON: "",
      PRIVATE_DOCS_ENABLED: "on",
      PRIVATE_DOCS_TOKEN: "docs-token",
    });

    const config = loadConfig();

    expect(config.FIREBASE_STRICT_AUTH).toBe(true);
    expect(config.PRIVATE_DOCS_ENABLED).toBe(true);
    expect(config.PRIVATE_DOCS_TOKEN).toBe("docs-token");
  });

  it("fails when credentials json is invalid or missing required fields", () => {
    withEnv({
      DATABASE_URL: "postgresql://users:users@localhost:7434/usersdb?schema=public",
      PRIVATE_DOCS_ENABLED: "false",
      FIREBASE_STRICT_AUTH: "true",
      FIREBASE_CREDENTIALS_JSON: "not-json",
      FIREBASE_PROJECT_ID: "",
      FIREBASE_CLIENT_EMAIL: "",
      FIREBASE_PRIVATE_KEY: "",
    });

    expect(() => loadConfig()).toThrow("Invalid environment configuration for microservice-users");

    withEnv({
      DATABASE_URL: "postgresql://users:users@localhost:7434/usersdb?schema=public",
      PRIVATE_DOCS_ENABLED: "false",
      FIREBASE_STRICT_AUTH: "true",
      FIREBASE_CREDENTIALS_JSON: '{"project_id":"project-x"}',
      FIREBASE_PROJECT_ID: "",
      FIREBASE_CLIENT_EMAIL: "",
      FIREBASE_PRIVATE_KEY: "",
    });

    expect(() => loadConfig()).toThrow("Invalid environment configuration for microservice-users");
  });

  it("fails when private docs are enabled without a token", () => {
    withEnv({
      DATABASE_URL: "postgresql://users:users@localhost:7434/usersdb?schema=public",
      PRIVATE_DOCS_ENABLED: "true",
      PRIVATE_DOCS_TOKEN: "",
      FIREBASE_STRICT_AUTH: "true",
      FIREBASE_PROJECT_ID: "project-triplet",
      FIREBASE_CLIENT_EMAIL: "triplet@test.dev",
      FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
      FIREBASE_CREDENTIALS_JSON: "",
    });

    expect(() => loadConfig()).toThrow("Invalid environment configuration for microservice-users");
  });

  it("normalizes optional blanks and boolean synonyms when strict auth is disabled", () => {
    withEnv({
      DATABASE_URL: "postgresql://users:users@localhost:7434/usersdb?schema=public",
      FIREBASE_STRICT_AUTH: "off",
      FIREBASE_PROJECT_ID: "   ",
      FIREBASE_CLIENT_EMAIL: "   ",
      FIREBASE_PRIVATE_KEY: "   ",
      FIREBASE_CREDENTIALS_JSON: "   ",
      PRIVATE_DOCS_ENABLED: "no",
      PRIVATE_DOCS_TOKEN: "   ",
    });

    const config = loadConfig();

    expect(config.FIREBASE_STRICT_AUTH).toBe(false);
    expect(config.PRIVATE_DOCS_ENABLED).toBe(false);
    expect(config.FIREBASE_PROJECT_ID).toBeUndefined();
    expect(config.FIREBASE_CREDENTIALS_JSON).toBeUndefined();
    expect(config.PRIVATE_DOCS_TOKEN).toBeUndefined();
  });
});

describe("loadConfig boolean parsing", () => {
  const base = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://users:users@localhost:7434/usersdb?schema=public",
    FIREBASE_CREDENTIALS_JSON: "",
    FIREBASE_PROJECT_ID: "",
    FIREBASE_CLIENT_EMAIL: "",
    FIREBASE_PRIVATE_KEY: ""
  };

  it.each(["true", "1", "yes", "on", " ON "])("treats %j as true", (value) => {
    withEnv({ ...base, PRIVATE_DOCS_ENABLED: value, PRIVATE_DOCS_TOKEN: "t", FIREBASE_STRICT_AUTH: "false" });
    expect(loadConfig().PRIVATE_DOCS_ENABLED).toBe(true);
  });

  it.each(["false", "0", "no", "off"])("treats %j as false", (value) => {
    withEnv({ ...base, PRIVATE_DOCS_ENABLED: value, FIREBASE_STRICT_AUTH: "false" });
    expect(loadConfig().PRIVATE_DOCS_ENABLED).toBe(false);
  });

  it("rejects values that are not recognised booleans", () => {
    withEnv({ ...base, PRIVATE_DOCS_ENABLED: "maybe", FIREBASE_STRICT_AUTH: "false" });
    expect(() => loadConfig()).toThrow("Invalid environment configuration");
  });

  it("defaults the verified-token cache to 60 s / 1000 entries and validates overrides", () => {
    const base = {
      DATABASE_URL: "postgresql://users:users@localhost:7434/usersdb?schema=public",
      FIREBASE_STRICT_AUTH: "false",
      PRIVATE_DOCS_ENABLED: "false",
    };

    withEnv(base);
    expect(loadConfig()).toMatchObject({ AUTH_TOKEN_CACHE_TTL_SECONDS: 60, AUTH_TOKEN_CACHE_MAX_ENTRIES: 1000 });

    withEnv({ ...base, AUTH_TOKEN_CACHE_TTL_SECONDS: "0", AUTH_TOKEN_CACHE_MAX_ENTRIES: "50" });
    expect(loadConfig()).toMatchObject({ AUTH_TOKEN_CACHE_TTL_SECONDS: 0, AUTH_TOKEN_CACHE_MAX_ENTRIES: 50 });

    withEnv({ ...base, AUTH_TOKEN_CACHE_TTL_SECONDS: "601" });
    expect(() => loadConfig()).toThrow("Invalid environment configuration for microservice-users");
  });
});

describe("loadConfig proxy and rate limit settings", () => {
  const base = {
    DATABASE_URL: "postgresql://users:users@localhost:7434/usersdb?schema=public",
    FIREBASE_STRICT_AUTH: "false",
    PRIVATE_DOCS_ENABLED: "false",
  };

  it("defaults to no proxy trust and the documented rate limit", () => {
    withEnv({ ...base, TRUST_PROXY: undefined, RATE_LIMIT_MAX: undefined, RATE_LIMIT_WINDOW_MS: undefined });

    expect(loadConfig()).toMatchObject({ TRUST_PROXY: "false", RATE_LIMIT_MAX: 1000, RATE_LIMIT_WINDOW_MS: 60000 });
  });

  it("accepts overrides", () => {
    withEnv({ ...base, TRUST_PROXY: "10.0.0.0/8,loopback", RATE_LIMIT_MAX: "0", RATE_LIMIT_WINDOW_MS: "5000" });

    expect(loadConfig()).toMatchObject({ TRUST_PROXY: "10.0.0.0/8,loopback", RATE_LIMIT_MAX: 0, RATE_LIMIT_WINDOW_MS: 5000 });
  });

  it.each([
    ["TRUST_PROXY", "not-an-ip"],
    ["RATE_LIMIT_MAX", "-1"],
    ["RATE_LIMIT_WINDOW_MS", "10"],
  ])("rejects invalid %s=%s", (key, value) => {
    withEnv({ ...base, [key]: value });

    expect(() => loadConfig()).toThrow("Invalid environment configuration for microservice-users");
  });
});
