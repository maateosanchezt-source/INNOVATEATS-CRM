import { z } from "zod";

const booleanFromEnvironment = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "") {
      return false;
    }
  }

  return value;
}, z.boolean());

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional()
);
const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.url().optional()
);
const optionalBase64Aes256Key = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .regex(
      /^[A-Za-z0-9+/]{43}=$/u,
      "Gmail token encryption key must be a base64-encoded 32-byte key."
    )
    .optional()
);

const serverEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),

    DATABASE_URL: z
      .string()
      .min(1)
      .default("postgresql://innovateats:innovateats-local-only@localhost:5432/innovateats"),
    TEMPORAL_ADDRESS: z.string().min(1).default("localhost:7233"),
    TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
    TEMPORAL_TASK_QUEUE: z.string().min(1).default("innovateats-main"),

    S3_ENDPOINT: z.url().default("http://localhost:9000"),
    S3_BUCKET: z.string().min(1).default("innovateats"),
    S3_ACCESS_KEY: optionalNonEmptyString,
    S3_SECRET_KEY: optionalNonEmptyString,

    BETTER_AUTH_SECRET: optionalNonEmptyString,
    AUTHORIZED_EMAIL: z.email().default("maateosanchezt@gmail.com"),
    GOOGLE_CLIENT_ID: optionalNonEmptyString,
    GOOGLE_CLIENT_SECRET: optionalNonEmptyString,

    OPENAI_API_KEY: optionalNonEmptyString,
    OPENAI_RESEARCH_MODEL: optionalNonEmptyString,
    OPENAI_STRATEGY_MODEL: optionalNonEmptyString,
    OPENAI_COPY_MODEL: optionalNonEmptyString,
    OPENAI_QA_MODEL: optionalNonEmptyString,
    OPENAI_CLASSIFIER_MODEL: optionalNonEmptyString,

    GMAIL_SENDER_EMAIL: z.email().optional().or(z.literal("")),
    GMAIL_OAUTH_CLIENT_ID: optionalNonEmptyString,
    GMAIL_OAUTH_CLIENT_SECRET: optionalNonEmptyString,
    GMAIL_OAUTH_REDIRECT_URI: optionalUrl,
    GMAIL_TOKEN_ENCRYPTION_KEY: optionalBase64Aes256Key,
    GMAIL_DELIVERY_MODE: z.enum(["dry_run", "sandbox", "production"]).default("dry_run"),
    GMAIL_SANDBOX_RECIPIENT: z.email().default("maateosanchezt@gmail.com"),
    GMAIL_SANDBOX_SEND_APPROVED: booleanFromEnvironment.default(false),
    GMAIL_INBOUND_OAUTH_APPROVED: booleanFromEnvironment.default(false),
    GMAIL_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(3600).default(30),
    REQUIRED_OUTREACH_WEBSITE: z
      .literal("https://innovateats.com")
      .default("https://innovateats.com"),

    EMAIL_VERIFIER_PROVIDER: z.string().min(1).default("disabled"),
    EMAIL_VERIFIER_API_KEY: optionalNonEmptyString,

    SENTRY_DSN: optionalNonEmptyString,
    OTEL_EXPORTER_OTLP_ENDPOINT: optionalNonEmptyString,

    GLOBAL_DRY_RUN: booleanFromEnvironment.default(true),
    RESEARCH_ENABLED: booleanFromEnvironment.default(false),
    CONTACT_ENRICHMENT_ENABLED: booleanFromEnvironment.default(false),
    MESSAGE_GENERATION_ENABLED: booleanFromEnvironment.default(false),
    EMAIL_SEND_ENABLED: booleanFromEnvironment.default(false),
    AUTONOMOUS_SEND_ENABLED: booleanFromEnvironment.default(false),
    INBOUND_PROCESSING_ENABLED: booleanFromEnvironment.default(false),
    SOCIAL_MANUAL_QUEUE_ENABLED: booleanFromEnvironment.default(false),
    PRODUCTION_SEND_APPROVED: booleanFromEnvironment.default(false),

    DAILY_TOKEN_BUDGET_USD: z.coerce.number().nonnegative().max(10_000).default(20),
    DAILY_EMAIL_CAP: z.coerce.number().int().nonnegative().max(500).default(10)
  })
  .superRefine((environment, context) => {
    const hasGoogleClientId = environment.GOOGLE_CLIENT_ID !== undefined;
    const hasGoogleClientSecret = environment.GOOGLE_CLIENT_SECRET !== undefined;
    if (hasGoogleClientId !== hasGoogleClientSecret) {
      context.addIssue({
        code: "custom",
        message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together.",
        path: ["GOOGLE_CLIENT_ID"]
      });
    }

    const gmailOAuthValues = [
      environment.GMAIL_OAUTH_CLIENT_ID,
      environment.GMAIL_OAUTH_CLIENT_SECRET,
      environment.GMAIL_OAUTH_REDIRECT_URI,
      environment.GMAIL_TOKEN_ENCRYPTION_KEY
    ];
    const configuredGmailOAuthValues = gmailOAuthValues.filter(
      (value) => value !== undefined
    ).length;
    if (
      configuredGmailOAuthValues !== 0 &&
      configuredGmailOAuthValues !== gmailOAuthValues.length
    ) {
      context.addIssue({
        code: "custom",
        message:
          "GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, and GMAIL_TOKEN_ENCRYPTION_KEY must be configured together.",
        path: ["GMAIL_OAUTH_CLIENT_ID"]
      });
    }

    if (environment.AUTONOMOUS_SEND_ENABLED && !environment.EMAIL_SEND_ENABLED) {
      context.addIssue({
        code: "custom",
        message: "Autonomous sending cannot be enabled while email sending is disabled.",
        path: ["AUTONOMOUS_SEND_ENABLED"]
      });
    }

    if (environment.INBOUND_PROCESSING_ENABLED && !environment.GMAIL_INBOUND_OAUTH_APPROVED) {
      context.addIssue({
        code: "custom",
        message:
          "Inbound Gmail processing requires explicit approval of the restricted gmail.readonly scope.",
        path: ["GMAIL_INBOUND_OAUTH_APPROVED"]
      });
    }

    if (
      environment.EMAIL_SEND_ENABLED &&
      !environment.GLOBAL_DRY_RUN &&
      environment.GMAIL_DELIVERY_MODE === "production" &&
      !environment.PRODUCTION_SEND_APPROVED
    ) {
      context.addIssue({
        code: "custom",
        message: "Real email requires PRODUCTION_SEND_APPROVED=true.",
        path: ["PRODUCTION_SEND_APPROVED"]
      });
    }

    if (
      environment.EMAIL_SEND_ENABLED &&
      !environment.GLOBAL_DRY_RUN &&
      environment.GMAIL_DELIVERY_MODE === "sandbox" &&
      !environment.GMAIL_SANDBOX_SEND_APPROVED
    ) {
      context.addIssue({
        code: "custom",
        message: "External sandbox delivery requires GMAIL_SANDBOX_SEND_APPROVED=true.",
        path: ["GMAIL_SANDBOX_SEND_APPROVED"]
      });
    }

    if (
      environment.GMAIL_DELIVERY_MODE === "sandbox" &&
      environment.GMAIL_SANDBOX_RECIPIENT.toLowerCase() !==
        environment.AUTHORIZED_EMAIL.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        message: "The Gmail sandbox recipient must be the authorized internal user.",
        path: ["GMAIL_SANDBOX_RECIPIENT"]
      });
    }

    if (
      environment.GMAIL_DELIVERY_MODE === "production" &&
      (environment.GMAIL_SENDER_EMAIL === undefined || environment.GMAIL_SENDER_EMAIL === "")
    ) {
      context.addIssue({
        code: "custom",
        message: "Production Gmail delivery requires GMAIL_SENDER_EMAIL.",
        path: ["GMAIL_SENDER_EMAIL"]
      });
    }

    if (
      environment.NODE_ENV === "production" &&
      (environment.BETTER_AUTH_SECRET === undefined || environment.BETTER_AUTH_SECRET.length < 32)
    ) {
      context.addIssue({
        code: "custom",
        message: "Production requires a BETTER_AUTH_SECRET of at least 32 characters.",
        path: ["BETTER_AUTH_SECRET"]
      });
    }
  });

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export class EnvironmentValidationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Invalid server configuration: ${issues.join("; ")}`);
    this.name = "EnvironmentValidationError";
    this.issues = issues;
  }
}

export function parseServerEnvironment(
  input: Record<string, string | undefined>
): ServerEnvironment {
  const result = serverEnvironmentSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`
    );
    throw new EnvironmentValidationError(issues);
  }

  return result.data;
}

export function loadServerEnvironment(): ServerEnvironment {
  return parseServerEnvironment(process.env);
}

export function publicSafetyConfiguration(environment: ServerEnvironment) {
  return {
    authorizedEmail: environment.AUTHORIZED_EMAIL,
    autonomousSendEnabled: environment.AUTONOMOUS_SEND_ENABLED,
    dryRun: environment.GLOBAL_DRY_RUN,
    emailSendEnabled: environment.EMAIL_SEND_ENABLED,
    gmailDeliveryMode: environment.GMAIL_DELIVERY_MODE,
    inboundProcessingEnabled: environment.INBOUND_PROCESSING_ENABLED,
    requiredWebsite: environment.REQUIRED_OUTREACH_WEBSITE
  } as const;
}

export function googleOAuthIsConfigured(environment: ServerEnvironment): boolean {
  return (
    environment.GOOGLE_CLIENT_ID !== undefined && environment.GOOGLE_CLIENT_SECRET !== undefined
  );
}
