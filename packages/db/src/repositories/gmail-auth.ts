import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import { auditLog, gmailCredentials, gmailOauthStates, senders } from "../schema/index.js";

export interface GmailSenderRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly active: boolean;
  readonly sandbox: boolean;
  readonly dailyCap: number;
  readonly timezone: string;
  readonly connected: boolean;
}

export interface ConsumedGmailOAuthState {
  readonly senderEmail: string;
  readonly returnPath: string;
}

export interface GmailCredentialRecord {
  readonly senderId: string;
  readonly senderEmail: string;
  readonly encryptedRefreshToken: string;
  readonly scopes: readonly string[];
  readonly version: number;
}

export class GmailOAuthStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GmailOAuthStateError";
  }
}

function stateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export class PostgresGmailAuthRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async listSenders(): Promise<readonly GmailSenderRecord[]> {
    const rows = await this.database
      .select({
        sender: senders,
        connected: sql<boolean>`EXISTS (
          SELECT 1
          FROM gmail_credentials credential
          WHERE credential.sender_id = ${senders.id}
        )`
      })
      .from(senders)
      .orderBy(senders.email);
    return rows.map((row) => ({ ...row.sender, connected: Boolean(row.connected) }));
  }

  public async createOAuthState(
    senderEmail: string,
    returnPath: string,
    actorId: string
  ): Promise<string> {
    const state = randomBytes(32).toString("base64url");
    await this.database.insert(gmailOauthStates).values({
      stateHash: stateHash(state),
      senderEmail: senderEmail.trim().toLowerCase(),
      returnPath,
      actorId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000)
    });
    return state;
  }

  public async consumeOAuthState(state: string, actorId: string): Promise<ConsumedGmailOAuthState> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(gmailOauthStates)
        .where(
          and(
            eq(gmailOauthStates.stateHash, stateHash(state)),
            eq(gmailOauthStates.actorId, actorId),
            isNull(gmailOauthStates.consumedAt),
            gt(gmailOauthStates.expiresAt, new Date())
          )
        )
        .limit(1)
        .for("update");
      if (row === undefined) {
        throw new GmailOAuthStateError("Gmail OAuth state is invalid, expired, or already used.");
      }
      await transaction
        .update(gmailOauthStates)
        .set({ consumedAt: new Date() })
        .where(eq(gmailOauthStates.stateHash, row.stateHash));
      return { senderEmail: row.senderEmail, returnPath: row.returnPath };
    });
  }

  public async saveGrant(
    senderEmail: string,
    encryptedRefreshToken: string,
    scopes: readonly string[],
    actorId: string
  ): Promise<GmailSenderRecord> {
    const normalizedEmail = senderEmail.trim().toLowerCase();
    const senderId = await this.database.transaction(async (transaction) => {
      const [sender] = await transaction
        .insert(senders)
        .values({
          email: normalizedEmail,
          displayName: "Mateo Sanchez / InnovatEats",
          active: true,
          sandbox: true,
          dailyCap: 10,
          timezone: "Europe/Madrid"
        })
        .onConflictDoUpdate({
          target: senders.email,
          set: { active: true, updatedAt: new Date() }
        })
        .returning({ id: senders.id });
      if (sender === undefined) {
        throw new Error("Gmail sender could not be resolved.");
      }
      const [latest] = await transaction
        .select({ version: gmailCredentials.version })
        .from(gmailCredentials)
        .where(eq(gmailCredentials.senderId, sender.id))
        .orderBy(desc(gmailCredentials.version))
        .limit(1);
      const version = (latest?.version ?? 0) + 1;
      const [credential] = await transaction
        .insert(gmailCredentials)
        .values({
          senderId: sender.id,
          version,
          encryptedRefreshToken,
          scopes: [...scopes],
          grantedBy: actorId
        })
        .returning({ id: gmailCredentials.id });
      if (credential === undefined) {
        throw new Error("Gmail credential insert returned no record.");
      }
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: "gmail.oauth_granted",
        entityType: "sender",
        entityId: sender.id,
        after: {
          senderEmail: normalizedEmail,
          credentialVersion: version,
          scopes: [...scopes]
        }
      });
      return sender.id;
    });

    const sender = (await this.listSenders()).find((candidate) => candidate.id === senderId);
    if (sender === undefined) {
      throw new Error("Connected Gmail sender could not be reloaded.");
    }
    return sender;
  }

  public async getLatestCredential(senderId: string): Promise<GmailCredentialRecord | null> {
    const [row] = await this.database
      .select({
        senderId: senders.id,
        senderEmail: senders.email,
        encryptedRefreshToken: gmailCredentials.encryptedRefreshToken,
        scopes: gmailCredentials.scopes,
        version: gmailCredentials.version
      })
      .from(senders)
      .innerJoin(gmailCredentials, eq(gmailCredentials.senderId, senders.id))
      .where(and(eq(senders.id, senderId), eq(senders.active, true)))
      .orderBy(desc(gmailCredentials.version))
      .limit(1);
    return row ?? null;
  }
}
