import { createInternalAuth } from "@innovateats/auth";
import {
  googleOAuthIsConfigured,
  loadServerEnvironment,
  temporalConnectionConfiguration,
  type ServerEnvironment
} from "@innovateats/config";
import {
  createDatabaseClient,
  PostgresDataGovernanceRepository,
  PostgresDiscoveryRepository,
  PostgresContactRepository,
  PostgresComplianceRepository,
  PostgresCrmRepository,
  PostgresGmailAuthRepository,
  PostgresInboundRepository,
  PostgresMessageRepository,
  PostgresMetricsRepository,
  PostgresOutreachRepository,
  PostgresReadinessRepository,
  PostgresResearchRepository,
  PostgresSafetyControlRepository,
  type DatabaseClient
} from "@innovateats/db";
import { SafetyControlService } from "@innovateats/feature-flags";
import {
  DisabledEmailVerificationProvider,
  GoogleGmailOAuth,
  NodeMxResolver,
  SecurePublicFetcher
} from "@innovateats/integrations";
import { Client, Connection } from "@temporalio/client";

const localDevelopmentSecret = "innovateats-local-development-secret-do-not-use-in-production";

interface RuntimeSingletons {
  database?: DatabaseClient;
  auth?: ReturnType<typeof createInternalAuth>;
  temporal?: Promise<Client>;
}

const globalRuntime = globalThis as typeof globalThis & {
  __innovateatsRuntime?: RuntimeSingletons;
};

function singletons(): RuntimeSingletons {
  globalRuntime.__innovateatsRuntime ??= {};
  return globalRuntime.__innovateatsRuntime;
}

export function environment(): ServerEnvironment {
  return loadServerEnvironment();
}

export function databaseClient(): DatabaseClient {
  const runtime = singletons();
  runtime.database ??= createDatabaseClient(environment().DATABASE_URL);
  return runtime.database;
}

export function internalAuth(): ReturnType<typeof createInternalAuth> {
  const runtime = singletons();
  if (runtime.auth !== undefined) {
    return runtime.auth;
  }

  const config = environment();
  const secret =
    config.BETTER_AUTH_SECRET ??
    (config.NODE_ENV === "production" ? undefined : localDevelopmentSecret);
  if (secret === undefined) {
    throw new Error("BETTER_AUTH_SECRET is required in production.");
  }

  runtime.auth = createInternalAuth({
    database: databaseClient().db,
    appUrl: config.APP_URL,
    secret,
    authorizedEmail: config.AUTHORIZED_EMAIL,
    ...(googleOAuthIsConfigured(config)
      ? {
          google: {
            clientId: config.GOOGLE_CLIENT_ID as string,
            clientSecret: config.GOOGLE_CLIENT_SECRET as string
          }
        }
      : {})
  });

  return runtime.auth;
}

export function safetyControlService(): SafetyControlService {
  return new SafetyControlService(new PostgresSafetyControlRepository(databaseClient().db));
}

export function crmRepository(): PostgresCrmRepository {
  return new PostgresCrmRepository(databaseClient().db);
}

export function discoveryRepository(): PostgresDiscoveryRepository {
  return new PostgresDiscoveryRepository(databaseClient().db);
}

export function researchRepository(): PostgresResearchRepository {
  return new PostgresResearchRepository(databaseClient().db);
}

export function contactRepository(): PostgresContactRepository {
  return new PostgresContactRepository(databaseClient().db);
}

export function complianceRepository(): PostgresComplianceRepository {
  return new PostgresComplianceRepository(databaseClient().db);
}

export function messageRepository(): PostgresMessageRepository {
  return new PostgresMessageRepository(databaseClient().db);
}

export function outreachRepository(): PostgresOutreachRepository {
  return new PostgresOutreachRepository(databaseClient().db);
}

export function gmailAuthRepository(): PostgresGmailAuthRepository {
  return new PostgresGmailAuthRepository(databaseClient().db);
}

export function inboundRepository(): PostgresInboundRepository {
  return new PostgresInboundRepository(databaseClient().db);
}

export function metricsRepository(): PostgresMetricsRepository {
  return new PostgresMetricsRepository(databaseClient().db);
}

export function readinessRepository(): PostgresReadinessRepository {
  return new PostgresReadinessRepository(databaseClient().db);
}

export function dataGovernanceRepository(): PostgresDataGovernanceRepository {
  return new PostgresDataGovernanceRepository(databaseClient().db);
}

export function gmailOAuth(): GoogleGmailOAuth {
  const config = environment();
  if (
    config.GMAIL_OAUTH_CLIENT_ID === undefined ||
    config.GMAIL_OAUTH_CLIENT_SECRET === undefined ||
    config.GMAIL_OAUTH_REDIRECT_URI === undefined ||
    config.GMAIL_OAUTH_REDIRECT_URI === ""
  ) {
    throw new Error("Gmail OAuth is not configured.");
  }
  return new GoogleGmailOAuth({
    clientId: config.GMAIL_OAUTH_CLIENT_ID,
    clientSecret: config.GMAIL_OAUTH_CLIENT_SECRET,
    redirectUri: config.GMAIL_OAUTH_REDIRECT_URI,
    senderEmail: config.GMAIL_SENDER_EMAIL || config.AUTHORIZED_EMAIL,
    inboundReadonlyApproved: config.GMAIL_INBOUND_OAUTH_APPROVED
  });
}

export function temporalClient(): Promise<Client> {
  const runtime = singletons();
  const config = environment();
  runtime.temporal ??= Connection.connect(temporalConnectionConfiguration(config)).then(
    (connection) =>
      new Client({
        connection,
        namespace: config.TEMPORAL_NAMESPACE
      })
  );
  return runtime.temporal;
}

export function emailVerificationProvider(): DisabledEmailVerificationProvider {
  const provider = environment().EMAIL_VERIFIER_PROVIDER;
  if (provider !== "disabled") {
    throw new Error(`Email verifier provider "${provider}" has no installed adapter.`);
  }
  return new DisabledEmailVerificationProvider();
}

export function mxResolver(): NodeMxResolver {
  return new NodeMxResolver();
}

export function securePublicFetcher(): SecurePublicFetcher {
  return new SecurePublicFetcher();
}
