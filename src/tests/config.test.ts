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
});
