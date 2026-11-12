import { z } from "zod";

import { DEFAULT_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_WINDOW_MS } from "./plugins/rateLimit.js";
import { parseTrustProxy } from "./plugins/trustProxy.js";

function isValidTrustProxy(value: string): boolean {
  try {
    parseTrustProxy(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * @module config
 * Environment configuration schema and loader for microservice-users.
 */

const OptionalEnvString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional()
);

const EnvBoolean = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return value;
}, z.boolean());

const ConfigSchema = z
  .object({
    SERVICE_NAME: z.string().default("microservice-users"),
    SERVICE_PORT: z.coerce.number().int().positive().default(7102),
    NODE_ENV: z.string().default("development"),
    METRICS_LOG_BUFFER_SIZE: z.coerce.number().int().min(50).max(5000).default(500),
    FIREBASE_PROJECT_ID: OptionalEnvString,
    FIREBASE_CLIENT_EMAIL: OptionalEnvString,
    FIREBASE_PRIVATE_KEY: OptionalEnvString,
    FIREBASE_CREDENTIALS_JSON: OptionalEnvString,
    FIREBASE_STRICT_AUTH: EnvBoolean.default(true),
    AUTH_TOKEN_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(600).default(60),
    AUTH_TOKEN_CACHE_MAX_ENTRIES: z.coerce.number().int().min(1).max(100000).default(1000),
    SUPERADMIN_FIREBASE_UID: OptionalEnvString,
    INSPECTOR_EMAILS: OptionalEnvString,
    PRIVATE_DOCS_ENABLED: EnvBoolean.default(true),
    PRIVATE_DOCS_PREFIX: z.string().default("/private/docs"),
    PRIVATE_DOCS_TOKEN: OptionalEnvString,
    TRUST_PROXY: z.string().default("false").refine(isValidTrustProxy, {
      message: "TRUST_PROXY must be true/false, a hop count, or a comma-separated list of IPs/CIDRs"
    }),
    RATE_LIMIT_MAX: z.coerce.number().int().min(0).max(1_000_000).default(DEFAULT_RATE_LIMIT_MAX),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3_600_000).default(DEFAULT_RATE_LIMIT_WINDOW_MS),
    DATABASE_URL: z.string().min(1)
  })
  .superRefine((config, ctx) => {
    if (!config.FIREBASE_STRICT_AUTH) {
      return;
    }

    const hasCredentialsJson = Boolean(config.FIREBASE_CREDENTIALS_JSON);
    const hasCredentialTriplet = Boolean(
      config.FIREBASE_PROJECT_ID && config.FIREBASE_CLIENT_EMAIL && config.FIREBASE_PRIVATE_KEY
    );

    if (!hasCredentialsJson && !hasCredentialTriplet) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FIREBASE_STRICT_AUTH"],
        message:
          "Strict Firebase auth requires FIREBASE_CREDENTIALS_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY"
      });
      return;
    }

    if (hasCredentialsJson) {
      try {
        const parsed = JSON.parse(config.FIREBASE_CREDENTIALS_JSON as string) as {
          project_id?: string;
          client_email?: string;
          private_key?: string;
        };

        if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["FIREBASE_CREDENTIALS_JSON"],
            message:
              "FIREBASE_CREDENTIALS_JSON must include project_id, client_email and private_key"
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["FIREBASE_CREDENTIALS_JSON"],
          message: "FIREBASE_CREDENTIALS_JSON must be valid JSON"
        });
      }
    }

    if (config.PRIVATE_DOCS_ENABLED && !config.PRIVATE_DOCS_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PRIVATE_DOCS_TOKEN"],
        message: "PRIVATE_DOCS_TOKEN is required when PRIVATE_DOCS_ENABLED=true"
      });
    }
  });

/** Parsed config; optional keys may be omitted by callers/tests (defaults apply). */
export type AppConfig = Omit<
  z.infer<typeof ConfigSchema>,
  "TRUST_PROXY" | "RATE_LIMIT_MAX" | "RATE_LIMIT_WINDOW_MS" | "AUTH_TOKEN_CACHE_TTL_SECONDS" | "AUTH_TOKEN_CACHE_MAX_ENTRIES"
> & {
  TRUST_PROXY?: string;
  RATE_LIMIT_MAX?: number;
  RATE_LIMIT_WINDOW_MS?: number;
  AUTH_TOKEN_CACHE_TTL_SECONDS?: number;
  AUTH_TOKEN_CACHE_MAX_ENTRIES?: number;
};

/** Parses and validates environment variables into an AppConfig. Throws on invalid config. */
export function loadConfig(): AppConfig {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("Invalid environment configuration for microservice-users");
  }
  return parsed.data;
}
