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
    INSPECTOR_EMAILS: undefined,
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

  describe("verified token cache", () => {
    const decoded = (exp?: number) => ({
      uid: "firebase-uid",
      email: "user@test.dev",
      email_verified: true,
      exp,
      firebase: { sign_in_provider: "password" },
    });
    const nowSeconds = () => Math.floor(Date.now() / 1000);

    it("verifies a repeated token once within the TTL and keys the cache by token", async () => {
      const { FirebaseAuthService } = await import("../app/services/firebaseAuthService.js");
      verifyIdTokenMock.mockResolvedValue(decoded(nowSeconds() + 3600));
      const service = new FirebaseAuthService(baseConfig({ AUTH_TOKEN_CACHE_TTL_SECONDS: 60 }));

      await service.authenticateFromBearer("Bearer token-a");
      await service.authenticateFromBearer("Bearer token-a");
      expect(verifyIdTokenMock).toHaveBeenCalledTimes(1);

      await service.authenticateFromBearer("Bearer token-b");
      expect(verifyIdTokenMock).toHaveBeenCalledTimes(2);
    });

    it("does not cache when the TTL is 0", async () => {
      const { FirebaseAuthService } = await import("../app/services/firebaseAuthService.js");
      verifyIdTokenMock.mockResolvedValue(decoded(nowSeconds() + 3600));
      const service = new FirebaseAuthService(baseConfig({ AUTH_TOKEN_CACHE_TTL_SECONDS: 0 }));

      await service.authenticateFromBearer("Bearer token-a");
      await service.authenticateFromBearer("Bearer token-a");
      expect(verifyIdTokenMock).toHaveBeenCalledTimes(2);
    });

    it("never caches past the token expiry and re-verifies after the TTL elapses", async () => {
      vi.useFakeTimers();
      try {
        const { FirebaseAuthService } = await import("../app/services/firebaseAuthService.js");
        const service = new FirebaseAuthService(baseConfig({ AUTH_TOKEN_CACHE_TTL_SECONDS: 60 }));

        // Token that expires in 10 s: cached for 10 s, not 60 s.
        verifyIdTokenMock.mockResolvedValue(decoded(nowSeconds() + 10));
        await service.authenticateFromBearer("Bearer short");
        vi.advanceTimersByTime(9_000);
        await service.authenticateFromBearer("Bearer short");
        expect(verifyIdTokenMock).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(2_000);
        await service.authenticateFromBearer("Bearer short");
        expect(verifyIdTokenMock).toHaveBeenCalledTimes(2);

        // Long-lived token: cached for the TTL only.
        verifyIdTokenMock.mockResolvedValue(decoded(nowSeconds() + 3600));
        await service.authenticateFromBearer("Bearer long");
        vi.advanceTimersByTime(59_000);
        await service.authenticateFromBearer("Bearer long");
        expect(verifyIdTokenMock).toHaveBeenCalledTimes(3);
        vi.advanceTimersByTime(2_000);
        await service.authenticateFromBearer("Bearer long");
        expect(verifyIdTokenMock).toHaveBeenCalledTimes(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not cache an already expired token or a failed verification", async () => {
      const { FirebaseAuthService } = await import("../app/services/firebaseAuthService.js");
      const service = new FirebaseAuthService(baseConfig());

      verifyIdTokenMock.mockResolvedValue(decoded(nowSeconds() - 5));
      await service.authenticateFromBearer("Bearer expired");
      await service.authenticateFromBearer("Bearer expired");
      expect(verifyIdTokenMock).toHaveBeenCalledTimes(2);

      verifyIdTokenMock.mockReset();
      verifyIdTokenMock.mockRejectedValue(new Error("revoked"));
      await expect(service.authenticateFromBearer("Bearer revoked")).rejects.toThrow("revoked");
      await expect(service.authenticateFromBearer("Bearer revoked")).rejects.toThrow("revoked");
      expect(verifyIdTokenMock).toHaveBeenCalledTimes(2);
    });

    it("stays bounded: evicts expired entries first, then the oldest", async () => {
      vi.useFakeTimers();
      try {
        const { FirebaseAuthService } = await import("../app/services/firebaseAuthService.js");
        verifyIdTokenMock.mockResolvedValue(decoded(nowSeconds() + 3600));
        const service = new FirebaseAuthService(
          baseConfig({ AUTH_TOKEN_CACHE_TTL_SECONDS: 60, AUTH_TOKEN_CACHE_MAX_ENTRIES: 2 })
        );

        await service.authenticateFromBearer("Bearer t1");
        vi.advanceTimersByTime(61_000); // t1 expires
        await service.authenticateFromBearer("Bearer t2");
        await service.authenticateFromBearer("Bearer t3"); // full: sweeps expired t1 first
        expect((service as unknown as { tokenCache: Map<string, unknown> }).tokenCache.size).toBe(2);

        await service.authenticateFromBearer("Bearer t4"); // full of live entries: drops oldest (t2)
        expect((service as unknown as { tokenCache: Map<string, unknown> }).tokenCache.size).toBe(2);
        verifyIdTokenMock.mockClear();
        await service.authenticateFromBearer("Bearer t3");
        await service.authenticateFromBearer("Bearer t4");
        expect(verifyIdTokenMock).not.toHaveBeenCalled();
        await service.authenticateFromBearer("Bearer t2");
        expect(verifyIdTokenMock).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("caches tokens without an exp claim for the TTL", async () => {
      const { FirebaseAuthService } = await import("../app/services/firebaseAuthService.js");
      verifyIdTokenMock.mockResolvedValue(decoded(undefined));
      const service = new FirebaseAuthService(baseConfig());

      await service.authenticateFromBearer("Bearer no-exp");
      await service.authenticateFromBearer("Bearer no-exp");
      expect(verifyIdTokenMock).toHaveBeenCalledTimes(1);
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

  it("rejects bearer tokens when Firebase is not configured even if strict auth is disabled", async () => {
    const { FirebaseAuthService } = await import("../app/services/firebaseAuthService.js");

    const strictService = new FirebaseAuthService(baseConfig({ FIREBASE_STRICT_AUTH: true }));
    const relaxedService = new FirebaseAuthService(baseConfig({
      FIREBASE_PROJECT_ID: undefined,
      FIREBASE_CLIENT_EMAIL: undefined,
      FIREBASE_PRIVATE_KEY: undefined,
    }));

    await expect(strictService.authenticateFromBearer(undefined)).rejects.toThrow("Missing bearer token");
    await expect(relaxedService.authenticateFromBearer("Basic token")).rejects.toThrow("Missing bearer token");
    await expect(relaxedService.authenticateFromBearer("Bearer header.payload.signature")).rejects.toThrow(
      "Firebase auth is not configured"
    );
  });
});