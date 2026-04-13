import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../app/config.js";

const certMock = vi.fn((value) => value);
const getAppsMock = vi.fn(() => []);
const initializeAppMock = vi.fn();

vi.mock("firebase-admin/app", () => ({
  cert: certMock,
  getApps: getAppsMock,
  initializeApp: initializeAppMock,
}));

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    SERVICE_NAME: "microservice-users",
    SERVICE_PORT: 7100,
    NODE_ENV: "test",
    METRICS_LOG_BUFFER_SIZE: 500,
    FIREBASE_PROJECT_ID: "your-firebase-project-id",
    FIREBASE_CLIENT_EMAIL: "firebase-adminsdk-xxxx@your-project.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n",
    FIREBASE_CREDENTIALS_JSON: undefined,
    FIREBASE_STRICT_AUTH: false,
    SUPERADMIN_FIREBASE_UID: undefined,
    PRIVATE_DOCS_ENABLED: false,
    PRIVATE_DOCS_PREFIX: "/private/docs",
    PRIVATE_DOCS_TOKEN: undefined,
    DATABASE_URL: "postgresql://users:users@localhost:7434/usersdb?schema=public",
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  getAppsMock.mockReturnValue([]);
});

describe("FirebaseAuthService", () => {
  it("ignores invalid Firebase credentials when strict auth is disabled", async () => {
    initializeAppMock.mockImplementation(() => {
      throw new Error("Invalid PEM formatted message.");
    });

    const { FirebaseAuthService } = await import("../app/services/firebaseAuthService.js");

    expect(() => new FirebaseAuthService(baseConfig({ FIREBASE_STRICT_AUTH: false }))).not.toThrow();
  });

  it("throws on invalid Firebase credentials when strict auth is enabled", async () => {
    initializeAppMock.mockImplementation(() => {
      throw new Error("Invalid PEM formatted message.");
    });

    const { FirebaseAuthService } = await import("../app/services/firebaseAuthService.js");

    expect(() => new FirebaseAuthService(baseConfig({ FIREBASE_STRICT_AUTH: true }))).toThrow(
      "Invalid PEM formatted message."
    );
  });
});