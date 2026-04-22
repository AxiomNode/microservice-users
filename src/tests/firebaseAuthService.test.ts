import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "firebase-admin/app";

import type { AppConfig } from "../app/config.js";

const certMock = vi.fn((value) => value);
const getAppsMock = vi.fn<() => App[]>(() => []);
const initializeAppMock = vi.fn();
const verifyIdTokenMock = vi.fn();
const getAuthMock = vi.fn(() => ({ verifyIdToken: verifyIdTokenMock }));

initializeAppMock.mockReturnValue({ name: "firebase-app" });

vi.mock("firebase-admin/app", () => ({
  cert: certMock,
  getApps: getAppsMock,
  initializeApp: initializeAppMock,
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: getAuthMock,
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
  certMock.mockReset();
  getAppsMock.mockReturnValue([]);
  initializeAppMock.mockReset();
  initializeAppMock.mockReturnValue({ name: "firebase-app" });
  verifyIdTokenMock.mockReset();
  getAuthMock.mockClear();
});

function encodeJwtPayload(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `header.${encoded}.signature`;
}

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

  it("reuses an already initialized Firebase app", async () => {
    const existingApp = { name: "existing-app" } as unknown as App;
    getAppsMock.mockReturnValue([existingApp]);

    const { FirebaseAuthService } = await import("../app/services/firebaseAuthService.js");

    expect(() => new FirebaseAuthService(baseConfig())).not.toThrow();
    expect(initializeAppMock).not.toHaveBeenCalled();
  });

  it("initializes Firebase from FIREBASE_CREDENTIALS_JSON", async () => {
    const { FirebaseAuthService } = await import("../app/services/firebaseAuthService.js");

    new FirebaseAuthService(
      baseConfig({
        FIREBASE_PROJECT_ID: undefined,
        FIREBASE_CLIENT_EMAIL: undefined,
        FIREBASE_PRIVATE_KEY: undefined,
        FIREBASE_CREDENTIALS_JSON: JSON.stringify({
          project_id: "project-json",
          client_email: "json@test.dev",
          private_key: "line1\\nline2",
        }),
      })
    );

    expect(certMock).toHaveBeenCalledWith({
      projectId: "project-json",
      clientEmail: "json@test.dev",
      privateKey: "line1\\nline2",
    });
    expect(initializeAppMock).toHaveBeenCalledTimes(1);
  });

  it("authenticates through Firebase verifyIdToken when the app is configured", async () => {
    const { FirebaseAuthService } = await import("../app/services/firebaseAuthService.js");
    verifyIdTokenMock.mockResolvedValue({
      uid: "firebase-uid",
      email: "user@test.dev",
      email_verified: true,
      name: "User Test",
      picture: "https://img.test/avatar.png",
      firebase: { sign_in_provider: "password" },
    });

    const service = new FirebaseAuthService(baseConfig());
    const identity = await service.authenticateFromBearer("Bearer token-123");

    expect(getAuthMock).toHaveBeenCalledTimes(1);
    expect(verifyIdTokenMock).toHaveBeenCalledWith("token-123", true);
    expect(identity).toEqual({
      firebaseUid: "firebase-uid",
      email: "user@test.dev",
      emailVerified: true,
      displayName: "User Test",
      photoUrl: "https://img.test/avatar.png",
      provider: "password",
    });
  });

  it("supports dev uid fallback when strict auth is disabled and no token is present", async () => {
    const { FirebaseAuthService } = await import("../app/services/firebaseAuthService.js");

    const service = new FirebaseAuthService(baseConfig({
      FIREBASE_PROJECT_ID: undefined,
      FIREBASE_CLIENT_EMAIL: undefined,
      FIREBASE_PRIVATE_KEY: undefined,
    }));

    await expect(service.authenticateFromBearer(undefined, "dev-user")).resolves.toEqual({
      firebaseUid: "dev-user",
      emailVerified: false,
      provider: "dev",
    });
  });

  it("decodes JWT payload without verification when strict auth is disabled and Firebase is not configured", async () => {
    const { FirebaseAuthService } = await import("../app/services/firebaseAuthService.js");

    const service = new FirebaseAuthService(baseConfig({
      FIREBASE_PROJECT_ID: undefined,
      FIREBASE_CLIENT_EMAIL: undefined,
      FIREBASE_PRIVATE_KEY: undefined,
    }));

    const identity = await service.authenticateFromBearer(
      `Bearer ${encodeJwtPayload({
        uid: "jwt-user",
        email: "jwt@test.dev",
        email_verified: false,
        name: "JWT User",
        picture: "https://img.test/jwt.png",
      })}`
    );

    expect(identity).toEqual({
      firebaseUid: "jwt-user",
      email: "jwt@test.dev",
      emailVerified: false,
      displayName: "JWT User",
      photoUrl: "https://img.test/jwt.png",
      provider: "firebase",
    });
  });

  it("rejects missing or malformed auth when strict auth does not allow fallback", async () => {
    const { FirebaseAuthService } = await import("../app/services/firebaseAuthService.js");

    const strictService = new FirebaseAuthService(baseConfig({ FIREBASE_STRICT_AUTH: true }));
    const relaxedService = new FirebaseAuthService(baseConfig({
      FIREBASE_PROJECT_ID: undefined,
      FIREBASE_CLIENT_EMAIL: undefined,
      FIREBASE_PRIVATE_KEY: undefined,
    }));

    await expect(strictService.authenticateFromBearer(undefined)).rejects.toThrow("Missing bearer token");
    await expect(relaxedService.authenticateFromBearer("Basic token")).rejects.toThrow("Missing bearer token");
    await expect(relaxedService.authenticateFromBearer("Bearer invalid.token")).rejects.toThrow(
      "Firebase auth is not configured"
    );
  });
});