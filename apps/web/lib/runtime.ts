import { createInternalAuth } from "@innovateats/auth";
import {
  googleOAuthIsConfigured,
  loadServerEnvironment,
  type ServerEnvironment
} from "@innovateats/config";
import {
  createDatabaseClient,
  PostgresContactRepository,
  PostgresCrmRepository,
  PostgresResearchRepository,
  PostgresSafetyControlRepository,
  type DatabaseClient
} from "@innovateats/db";
import { SafetyControlService } from "@innovateats/feature-flags";
import {
  DisabledEmailVerificationProvider,
  NodeMxResolver,
  SecurePublicFetcher
} from "@innovateats/integrations";

const localDevelopmentSecret = "innovateats-local-development-secret-do-not-use-in-production";

interface RuntimeSingletons {
  database?: DatabaseClient;
  auth?: ReturnType<typeof createInternalAuth>;
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

export function researchRepository(): PostgresResearchRepository {
  return new PostgresResearchRepository(databaseClient().db);
}

export function contactRepository(): PostgresContactRepository {
  return new PostgresContactRepository(databaseClient().db);
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
