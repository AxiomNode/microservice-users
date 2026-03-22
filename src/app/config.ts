import { z } from "zod";

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
    SERVICE_PORT: z.coerce.number().int().positive().default(7100),
    NODE_ENV: z.string().default("development"),
    METRICS_LOG_BUFFER_SIZE: z.coerce.number().int().min(50).max(5000).default(500),
    FIREBASE_PROJECT_ID: OptionalEnvString,
    FIREBASE_CLIENT_EMAIL: OptionalEnvString,
    FIREBASE_PRIVATE_KEY: OptionalEnvString,
    FIREBASE_CREDENTIALS_JSON: OptionalEnvString,
    FIREBASE_STRICT_AUTH: EnvBoolean.default(true),
    PRIVATE_DOCS_ENABLED: EnvBoolean.default(true),
    PRIVATE_DOCS_PREFIX: z.string().default("/private/docs"),
    PRIVATE_DOCS_TOKEN: OptionalEnvString,
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

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AppConfig {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("Invalid environment configuration for microservice-users");
  }
  return parsed.data;
}
