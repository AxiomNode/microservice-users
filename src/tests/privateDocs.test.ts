import "dotenv/config";

import { describe, expect, it } from "vitest";

import Fastify from "fastify";
import swagger from "@fastify/swagger";

import { AppConfig } from "../app/config.js";
import { registerPrivateDocs } from "../app/plugins/privateDocs.js";

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    SERVICE_NAME: "microservice-users",
    SERVICE_PORT: 7100,
    NODE_ENV: "test",
    METRICS_LOG_BUFFER_SIZE: 500,
    FIREBASE_PROJECT_ID: undefined,
    FIREBASE_CLIENT_EMAIL: undefined,
    FIREBASE_PRIVATE_KEY: undefined,
    FIREBASE_CREDENTIALS_JSON: undefined,
    FIREBASE_STRICT_AUTH: false,
    PRIVATE_DOCS_ENABLED: true,
    PRIVATE_DOCS_PREFIX: "/private/docs",
    PRIVATE_DOCS_TOKEN: "users_private_docs_token",
    DATABASE_URL: "postgresql://users:users@localhost:7434/usersdb?schema=public",
    ...overrides
  };
}

describe("private docs plugin", () => {
  it("returns 401 without token", async () => {
    const app = Fastify();
    await app.register(swagger, {
      openapi: { info: { title: "test", version: "1.0.0" } }
    });

    await registerPrivateDocs(app, baseConfig());

    const unauthorized = await app.inject({
      method: "GET",
      url: "/private/docs/json"
    });

    expect(unauthorized.statusCode).toBe(401);
    await app.close();
  });

  it("returns 200 with valid token", async () => {
    const app = Fastify();
    await app.register(swagger, {
      openapi: { info: { title: "test", version: "1.0.0" } }
    });

    await registerPrivateDocs(app, baseConfig({ PRIVATE_DOCS_TOKEN: "secret_users" }));

    const authorized = await app.inject({
      method: "GET",
      url: "/private/docs/json",
      headers: { "x-private-docs-token": "secret_users" }
    });

    expect(authorized.statusCode).toBe(200);
    await app.close();
  });
});
