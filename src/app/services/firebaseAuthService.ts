import { createHash } from "node:crypto";

import { App, cert, getApps, initializeApp } from "firebase-admin/app";
import { DecodedIdToken, getAuth } from "firebase-admin/auth";

import { AppConfig } from "../config.js";

/**
 * @module services/firebaseAuthService
 * Firebase Authentication integration — token verification and identity extraction.
 */

/** Normalized identity payload extracted from a Firebase ID token. */
export interface FirebaseIdentity {
  firebaseUid: string;
  email?: string;
  emailVerified: boolean;
  displayName?: string;
  photoUrl?: string;
  provider: string;
}

/** Handles Firebase ID-token verification and dev-mode bypass. */
export class FirebaseAuthService {
  private firebaseApp: App | null = null;

  /** Verified identities keyed by SHA-256 of the token (raw tokens are never stored). */
  private readonly tokenCache = new Map<string, { identity: FirebaseIdentity; expiresAt: number }>();

  constructor(private readonly config: AppConfig) {
    this.firebaseApp = this.initFirebaseApp();
  }

  async authenticateFromBearer(
    authorizationHeader?: string,
    devUidHeader?: string
  ): Promise<FirebaseIdentity> {
    const token = this.extractBearerToken(authorizationHeader);

    if (!token) {
      if (!this.config.FIREBASE_STRICT_AUTH && devUidHeader) {
        return {
          firebaseUid: devUidHeader,
          emailVerified: false,
          provider: "dev"
        };
      }
      throw new Error("Missing bearer token");
    }

    if (this.firebaseApp) {
      const cacheKey = createHash("sha256").update(token).digest("hex");
      const cached = this.readCache(cacheKey);
      if (cached) {
        return cached;
      }

      const decoded = await getAuth(this.firebaseApp).verifyIdToken(token, true);
      const identity = this.mapDecodedToken(decoded);
      this.writeCache(cacheKey, identity, decoded.exp);
      return identity;
    }

    throw new Error("Firebase auth is not configured");
  }

  private readCache(key: string): FirebaseIdentity | null {
    const entry = this.tokenCache.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.tokenCache.delete(key);
      return null;
    }
    return entry.identity;
  }

  /** Stores a verified identity for at most the configured TTL and never past the token expiry. */
  private writeCache(key: string, identity: FirebaseIdentity, expSeconds: number | undefined): void {
    const ttlMs = (this.config.AUTH_TOKEN_CACHE_TTL_SECONDS ?? 60) * 1000;
    if (ttlMs <= 0) {
      return;
    }

    const now = Date.now();
    const tokenExpiryMs = typeof expSeconds === "number" ? expSeconds * 1000 : Number.POSITIVE_INFINITY;
    const expiresAt = Math.min(now + ttlMs, tokenExpiryMs);
    if (expiresAt <= now) {
      return;
    }

    const maxEntries = this.config.AUTH_TOKEN_CACHE_MAX_ENTRIES ?? 1000;
    if (this.tokenCache.size >= maxEntries) {
      for (const [entryKey, entry] of this.tokenCache) {
        if (entry.expiresAt <= now) {
          this.tokenCache.delete(entryKey);
        }
      }
      // Map iterates in insertion order, so the first key is the oldest entry.
      while (this.tokenCache.size >= maxEntries) {
        const oldest = this.tokenCache.keys().next().value as string;
        this.tokenCache.delete(oldest);
      }
    }

    this.tokenCache.set(key, { identity, expiresAt });
  }

  private initFirebaseApp(): App | null {
    if (getApps().length > 0) {
      return getApps()[0] ?? null;
    }

    try {
      const credentialsJson = this.config.FIREBASE_CREDENTIALS_JSON;
      if (credentialsJson) {
        const parsed = JSON.parse(credentialsJson) as {
          project_id: string;
          client_email: string;
          private_key: string;
        };

        return initializeApp({
          credential: cert({
            projectId: parsed.project_id,
            clientEmail: parsed.client_email,
            privateKey: parsed.private_key
          })
        });
      }

      const projectId = this.config.FIREBASE_PROJECT_ID;
      const clientEmail = this.config.FIREBASE_CLIENT_EMAIL;
      const privateKey = this.config.FIREBASE_PRIVATE_KEY;

      if (!projectId || !clientEmail || !privateKey) {
        return null;
      }

      return initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n")
        })
      });
    } catch (error) {
      if (!this.config.FIREBASE_STRICT_AUTH) {
        return null;
      }
      throw error;
    }
  }

  private extractBearerToken(authorizationHeader?: string): string | null {
    if (!authorizationHeader) {
      return null;
    }

    const [scheme, token] = authorizationHeader.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      return null;
    }

    return token;
  }

  private mapDecodedToken(decoded: DecodedIdToken): FirebaseIdentity {
    const provider =
      typeof decoded.firebase?.sign_in_provider === "string"
        ? decoded.firebase.sign_in_provider
        : "firebase";

    return {
      firebaseUid: decoded.uid,
      email: decoded.email,
      emailVerified: Boolean(decoded.email_verified),
      displayName: decoded.name,
      photoUrl: decoded.picture,
      provider
    };
  }
}
