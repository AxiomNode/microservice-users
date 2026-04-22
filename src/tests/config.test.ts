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
