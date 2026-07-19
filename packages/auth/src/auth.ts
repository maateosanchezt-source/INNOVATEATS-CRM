import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import type { BetterAuthOptions } from "better-auth/minimal";

import type { AppDatabase } from "@innovateats/db";
import { schema } from "@innovateats/db/schema";
import { isAuthorizedEmail, normalizeEmail } from "@innovateats/shared";

export interface GoogleOAuthConfiguration {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface InternalAuthOptions {
  readonly database: AppDatabase;
  readonly appUrl: string;
  readonly secret: string;
  readonly authorizedEmail: string;
  readonly google?: GoogleOAuthConfiguration;
}

export type InternalAuth = ReturnType<typeof betterAuth>;

export function createInternalAuth(options: InternalAuthOptions): InternalAuth {
  const configuration: BetterAuthOptions = {
    appName: "InnovatEats Outreach OS",
    baseURL: options.appUrl,
    secret: options.secret,
    trustedOrigins: [options.appUrl],
    database: drizzleAdapter(options.database, {
      provider: "pg",
      schema
    }),
    advanced: {
      cookiePrefix: "innovateats_crm",
      database: {
        generateId: "uuid"
      },
      useSecureCookies: options.appUrl.startsWith("https://")
    },
    account: {
      accountLinking: {
        enabled: false
      },
      encryptOAuthTokens: true
    },
    rateLimit: {
      enabled: true,
      max: 30,
      window: 60
    },
    session: {
      expiresIn: 60 * 60 * 8,
      freshAge: 60 * 15,
      updateAge: 60 * 60
    },
    databaseHooks: {
      user: {
        create: {
          before: async (candidate) => {
            if (
              candidate.emailVerified !== true ||
              !isAuthorizedEmail(candidate.email, options.authorizedEmail)
            ) {
              return false;
            }
            return {
              data: {
                ...candidate,
                email: normalizeEmail(candidate.email)
              }
            };
          }
        },
        update: {
          before: async (candidate) => {
            if (
              candidate.email !== undefined &&
              !isAuthorizedEmail(candidate.email, options.authorizedEmail)
            ) {
              return false;
            }
            return {
              data:
                candidate.email === undefined
                  ? candidate
                  : {
                      ...candidate,
                      email: normalizeEmail(candidate.email)
                    }
            };
          }
        }
      }
    },
    ...(options.google === undefined
      ? {}
      : {
          socialProviders: {
            google: {
              clientId: options.google.clientId,
              clientSecret: options.google.clientSecret,
              mapProfileToUser: (profile: { email_verified?: boolean }) => ({
                emailVerified: profile.email_verified === true
              }),
              prompt: "select_account"
            }
          }
        })
  };

  return betterAuth(configuration);
}
