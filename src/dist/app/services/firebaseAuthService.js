import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
export class FirebaseAuthService {
    config;
    firebaseApp = null;
    constructor(config) {
        this.config = config;
        this.firebaseApp = this.initFirebaseApp();
    }
    async authenticateFromBearer(authorizationHeader, devUidHeader) {
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
            const decoded = await getAuth(this.firebaseApp).verifyIdToken(token, true);
            return this.mapDecodedToken(decoded);
        }
        if (!this.config.FIREBASE_STRICT_AUTH) {
            const decoded = this.decodeJwtWithoutVerification(token);
            if (decoded) {
                return this.mapDecodedToken(decoded);
            }
        }
        throw new Error("Firebase auth is not configured");
    }
    initFirebaseApp() {
        if (getApps().length > 0) {
            return getApps()[0] ?? null;
        }
        const credentialsJson = this.config.FIREBASE_CREDENTIALS_JSON;
        if (credentialsJson) {
            const parsed = JSON.parse(credentialsJson);
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
    }
    extractBearerToken(authorizationHeader) {
        if (!authorizationHeader) {
            return null;
        }
        const [scheme, token] = authorizationHeader.split(" ");
        if (scheme?.toLowerCase() !== "bearer" || !token) {
            return null;
        }
        return token;
    }
    decodeJwtWithoutVerification(token) {
        const parts = token.split(".");
        if (parts.length < 2 || !parts[1]) {
            return null;
        }
        try {
            const payload = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
            const parsed = JSON.parse(payload);
            return parsed;
        }
        catch {
            return null;
        }
    }
    mapDecodedToken(decoded) {
        const provider = typeof decoded.firebase?.sign_in_provider === "string"
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
