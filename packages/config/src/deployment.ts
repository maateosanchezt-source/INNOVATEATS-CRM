import type { ServerEnvironment } from "./env.js";

export const deploymentModes = ["dry_run", "sandbox", "production"] as const;
export type DeploymentMode = (typeof deploymentModes)[number];
export type DeploymentCheckStatus = "pass" | "warn" | "fail";

export interface DeploymentCheck {
  readonly key: string;
  readonly status: DeploymentCheckStatus;
  readonly message: string;
}

export interface DeploymentPreflightReport {
  readonly expectedMode: DeploymentMode;
  readonly ready: boolean;
  readonly checks: readonly DeploymentCheck[];
}

const placeholderPattern = /change[_-]?me|replace|placeholder|example\.invalid|<[^>]+>|your[_-]/iu;

function hasPlaceholder(value: string | undefined): boolean {
  return value === undefined || placeholderPattern.test(value);
}

function check(
  key: string,
  condition: boolean,
  passed: string,
  failed: string,
  failureStatus: Exclude<DeploymentCheckStatus, "pass"> = "fail"
): DeploymentCheck {
  return condition
    ? { key, status: "pass", message: passed }
    : { key, status: failureStatus, message: failed };
}

function databaseUsesTls(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    return ["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") ?? "");
  } catch {
    return false;
  }
}

function modelsConfigured(environment: ServerEnvironment): boolean {
  return [
    environment.OPENAI_RESEARCH_MODEL,
    environment.OPENAI_STRATEGY_MODEL,
    environment.OPENAI_COPY_MODEL,
    environment.OPENAI_QA_MODEL,
    environment.OPENAI_CLASSIFIER_MODEL
  ].every((model) => model !== undefined && !hasPlaceholder(model));
}

export function preflightDeployment(
  environment: ServerEnvironment,
  expectedMode: DeploymentMode
): DeploymentPreflightReport {
  const appUrl = new URL(environment.APP_URL);
  const googleConfigured =
    environment.GOOGLE_CLIENT_ID !== undefined &&
    environment.GOOGLE_CLIENT_SECRET !== undefined &&
    !hasPlaceholder(environment.GOOGLE_CLIENT_ID) &&
    !hasPlaceholder(environment.GOOGLE_CLIENT_SECRET);
  const gmailConfigured =
    environment.GMAIL_SENDER_EMAIL !== undefined &&
    environment.GMAIL_SENDER_EMAIL !== "" &&
    environment.GMAIL_OAUTH_CLIENT_ID !== undefined &&
    environment.GMAIL_OAUTH_CLIENT_SECRET !== undefined &&
    environment.GMAIL_OAUTH_REDIRECT_URI !== undefined &&
    environment.GMAIL_TOKEN_ENCRYPTION_KEY !== undefined &&
    !hasPlaceholder(environment.GMAIL_OAUTH_CLIENT_ID) &&
    !hasPlaceholder(environment.GMAIL_OAUTH_CLIENT_SECRET) &&
    !hasPlaceholder(environment.GMAIL_TOKEN_ENCRYPTION_KEY);
  const aiEnabled =
    environment.RESEARCH_ENABLED ||
    environment.MESSAGE_GENERATION_ENABLED ||
    environment.INBOUND_PROCESSING_ENABLED;
  const checks: DeploymentCheck[] = [
    check(
      "node_environment",
      environment.NODE_ENV === "production",
      "Production runtime validation is active.",
      "NODE_ENV must be production."
    ),
    check(
      "app_url",
      appUrl.protocol === "https:" && !hasPlaceholder(environment.APP_URL),
      "The public CRM URL uses HTTPS.",
      "APP_URL must be the final HTTPS CRM URL and cannot be a placeholder."
    ),
    check(
      "database_endpoint",
      environment.DATABASE_URL.startsWith("postgresql://") &&
        !hasPlaceholder(environment.DATABASE_URL),
      "A PostgreSQL endpoint is configured.",
      "DATABASE_URL must be a real PostgreSQL endpoint."
    ),
    check(
      "database_tls",
      databaseUsesTls(environment.DATABASE_URL),
      "The PostgreSQL connection requires TLS.",
      "DATABASE_URL must require or verify TLS through sslmode."
    ),
    check(
      "temporal_tls",
      environment.TEMPORAL_TLS_ENABLED,
      "Temporal transport TLS is enabled.",
      "TEMPORAL_TLS_ENABLED must be true for deployment."
    ),
    check(
      "temporal_authentication",
      environment.TEMPORAL_API_KEY !== undefined && !hasPlaceholder(environment.TEMPORAL_API_KEY),
      "Temporal API-key authentication is configured.",
      "TEMPORAL_API_KEY is required for the managed deployment contract."
    ),
    check(
      "auth_secret",
      environment.BETTER_AUTH_SECRET !== undefined &&
        environment.BETTER_AUTH_SECRET.length >= 32 &&
        !hasPlaceholder(environment.BETTER_AUTH_SECRET),
      "The authentication secret is strong and non-placeholder.",
      "BETTER_AUTH_SECRET must be a unique secret of at least 32 characters."
    ),
    check(
      "authorized_identity",
      environment.AUTHORIZED_EMAIL.toLowerCase() === "maateosanchezt@gmail.com",
      "Access remains restricted to Mateo's verified identity.",
      "AUTHORIZED_EMAIL must remain maateosanchezt@gmail.com."
    ),
    check(
      "google_auth",
      googleConfigured,
      "Google sign-in credentials are configured.",
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for CRM access."
    ),
    check(
      "required_website",
      environment.REQUIRED_OUTREACH_WEBSITE === "https://innovateats.com",
      "The mandatory InnovatEats trust URL is locked.",
      "REQUIRED_OUTREACH_WEBSITE must remain https://innovateats.com."
    ),
    check(
      "openai",
      !aiEnabled ||
        (environment.OPENAI_API_KEY !== undefined &&
          !hasPlaceholder(environment.OPENAI_API_KEY) &&
          modelsConfigured(environment)),
      aiEnabled
        ? "OpenAI credentials and task-specific models are configured."
        : "AI capabilities remain safely disabled.",
      "Enabled AI capabilities require OPENAI_API_KEY and all five task model routes."
    ),
    check(
      "observability",
      environment.SENTRY_DSN !== undefined || environment.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined,
      "At least one production telemetry sink is configured.",
      "Configure SENTRY_DSN or OTEL_EXPORTER_OTLP_ENDPOINT before pilot traffic.",
      "warn"
    )
  ];

  if (expectedMode === "dry_run") {
    checks.push(
      check(
        "dry_run_posture",
        environment.GMAIL_DELIVERY_MODE === "dry_run" &&
          environment.GLOBAL_DRY_RUN &&
          !environment.EMAIL_SEND_ENABLED &&
          !environment.AUTONOMOUS_SEND_ENABLED &&
          !environment.PRODUCTION_SEND_APPROVED,
        "Dry-run is fail-closed with all external email disabled.",
        "Dry-run deployment must keep global dry-run on and every email authorization off."
      )
    );
  } else {
    checks.push(
      check(
        "gmail_connection",
        gmailConfigured,
        "Gmail OAuth delivery credentials are configured.",
        "External delivery requires sender, OAuth client, redirect URI and encryption key."
      )
    );
    if (expectedMode === "sandbox") {
      checks.push(
        check(
          "sandbox_posture",
          environment.GMAIL_DELIVERY_MODE === "sandbox" &&
            !environment.GLOBAL_DRY_RUN &&
            environment.EMAIL_SEND_ENABLED &&
            environment.GMAIL_SANDBOX_SEND_APPROVED &&
            !environment.PRODUCTION_SEND_APPROVED &&
            !environment.AUTONOMOUS_SEND_ENABLED,
          "Sandbox is restricted to the approved Mateo-only recipient.",
          "Sandbox flags do not match the Mateo-only external test contract."
        )
      );
    } else {
      checks.push(
        check(
          "production_posture",
          environment.GMAIL_DELIVERY_MODE === "production" &&
            !environment.GLOBAL_DRY_RUN &&
            environment.EMAIL_SEND_ENABLED &&
            environment.PRODUCTION_SEND_APPROVED &&
            environment.PILOT_MODE &&
            environment.PILOT_HUMAN_APPROVAL_REQUIRED &&
            !environment.AUTONOMOUS_SEND_ENABLED,
          "Production flags remain inside the human-approved pilot envelope.",
          "Production flags do not match the controlled pilot contract."
        ),
        check(
          "postal_address",
          environment.BUSINESS_POSTAL_ADDRESS !== undefined &&
            !hasPlaceholder(environment.BUSINESS_POSTAL_ADDRESS),
          "A reviewed business postal address is configured.",
          "Production requires the real reviewed BUSINESS_POSTAL_ADDRESS."
        )
      );
    }
  }

  return {
    expectedMode,
    ready: checks.every((item) => item.status !== "fail"),
    checks
  };
}
