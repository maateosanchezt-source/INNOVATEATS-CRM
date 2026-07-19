import { buildHandoffPacket, classifyReply, extractVisibleReply } from "@innovateats/agents";
import type { ServerEnvironment } from "@innovateats/config";
import {
  PostgresGmailAuthRepository,
  PostgresInboundRepository,
  PostgresSafetyControlRepository,
  type AppDatabase,
  type GmailCredentialRecord,
  type GmailSenderRecord,
  type KnownGmailThread
} from "@innovateats/db";
import { SafetyControlService, type SafetySnapshot } from "@innovateats/feature-flags";
import {
  decryptGmailRefreshToken,
  GmailHistoryExpiredError,
  GmailMessageIgnoredError,
  gmailReadonlyScope,
  GoogleGmailInboundGateway,
  type GmailInboundGateway,
  type GmailMessageReference,
  type GmailOAuthConfiguration
} from "@innovateats/integrations";

const maximumBoundedThreadResync = 500;

export interface InboundPollLogger {
  info(context: Readonly<Record<string, unknown>>, message: string): void;
  warn(context: Readonly<Record<string, unknown>>, message: string): void;
  error(context: Readonly<Record<string, unknown>>, message: string): void;
}

export type GmailInboundGatewayFactory = (
  configuration: GmailOAuthConfiguration,
  refreshToken: string
) => GmailInboundGateway;

function defaultGatewayFactory(
  configuration: GmailOAuthConfiguration,
  refreshToken: string
): GmailInboundGateway {
  return new GoogleGmailInboundGateway(configuration, refreshToken);
}

function senderIsBlocked(snapshot: SafetySnapshot, senderId: string): boolean {
  return snapshot.activeKillSwitches.some(
    (killSwitch) =>
      killSwitch.scope.type === "global" ||
      (killSwitch.scope.type === "sender" && killSwitch.scope.id === senderId)
  );
}

export function referencesForKnownThreads(
  references: readonly GmailMessageReference[],
  knownThreads: readonly KnownGmailThread[]
): readonly GmailMessageReference[] {
  const knownIds = new Set(knownThreads.map((thread) => thread.threadId));
  const unique = new Map<string, GmailMessageReference>();
  for (const reference of references) {
    if (knownIds.has(reference.threadId)) {
      unique.set(reference.providerMessageId, reference);
    }
  }
  return [...unique.values()];
}

export class GmailInboundPoller {
  private timer: NodeJS.Timeout | undefined;
  private processing = false;
  private readonly authRepository: PostgresGmailAuthRepository;
  private readonly inboundRepository: PostgresInboundRepository;
  private readonly safetyService: SafetyControlService;

  public constructor(
    database: AppDatabase,
    private readonly environment: ServerEnvironment,
    private readonly logger: InboundPollLogger,
    private readonly createGateway: GmailInboundGatewayFactory = defaultGatewayFactory
  ) {
    this.authRepository = new PostgresGmailAuthRepository(database);
    this.inboundRepository = new PostgresInboundRepository(database);
    this.safetyService = new SafetyControlService(new PostgresSafetyControlRepository(database));
  }

  public start(): void {
    if (this.timer !== undefined || !this.environment.INBOUND_PROCESSING_ENABLED) {
      return;
    }
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.environment.GMAIL_POLL_INTERVAL_SECONDS * 1_000);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async safetySnapshot(): Promise<SafetySnapshot> {
    try {
      return await this.safetyService.snapshot();
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "Unknown safety read error" },
        "Inbound polling failed closed because safety controls are unavailable"
      );
      return SafetyControlService.safestPossibleSnapshot();
    }
  }

  private oauthConfiguration(credential: GmailCredentialRecord): GmailOAuthConfiguration | null {
    const clientId = this.environment.GMAIL_OAUTH_CLIENT_ID;
    const clientSecret = this.environment.GMAIL_OAUTH_CLIENT_SECRET;
    const redirectUri = this.environment.GMAIL_OAUTH_REDIRECT_URI;
    if (
      clientId === undefined ||
      clientSecret === undefined ||
      redirectUri === undefined ||
      this.environment.GMAIL_TOKEN_ENCRYPTION_KEY === undefined
    ) {
      this.logger.warn(
        { senderId: credential.senderId },
        "Inbound polling skipped because Gmail OAuth is incomplete"
      );
      return null;
    }
    return {
      clientId,
      clientSecret,
      redirectUri,
      senderEmail: credential.senderEmail,
      inboundReadonlyApproved: true
    };
  }

  private async processReference(
    sender: GmailSenderRecord,
    gateway: GmailInboundGateway,
    reference: GmailMessageReference
  ): Promise<void> {
    let message;
    try {
      message = await gateway.getInboundMessage(reference.providerMessageId);
    } catch (error) {
      if (error instanceof GmailMessageIgnoredError) {
        return;
      }
      throw error;
    }
    const classification = classifyReply(message);
    const context = await this.inboundRepository.getHandoffContext(
      sender.id,
      message.threadId,
      message.fromAddress,
      classification.classification === "bounce"
    );
    if (context === null) {
      return;
    }
    const packet = buildHandoffPacket(
      {
        brandName: context.brandName,
        founderNames: context.founderNames,
        product: context.product,
        stage: context.stage,
        discoverySignal: context.discoverySignal,
        opportunity: context.opportunity,
        messageHistory: context.messageHistory,
        replyBody: extractVisibleReply(message.bodyText),
        replyFrom: message.fromAddress,
        evidence: context.evidence
      },
      classification
    );
    const result = await this.inboundRepository.ingestReply(
      message,
      classification,
      packet,
      this.environment.AUTHORIZED_EMAIL
    );
    if (result.status === "created") {
      this.logger.info(
        {
          senderId: sender.id,
          threadId: message.threadId,
          classification: classification.classification
        },
        "CRM reply ingested and sequence stopped"
      );
    }
  }

  private async boundedResync(
    sender: GmailSenderRecord,
    gateway: GmailInboundGateway,
    knownThreads: readonly KnownGmailThread[]
  ): Promise<void> {
    const references: GmailMessageReference[] = [];
    for (const known of knownThreads.slice(0, maximumBoundedThreadResync)) {
      references.push(...(await gateway.listThreadMessages(known.threadId)));
    }
    for (const reference of referencesForKnownThreads(references, knownThreads)) {
      await this.processReference(sender, gateway, reference);
    }
  }

  private async pollSender(sender: GmailSenderRecord): Promise<void> {
    const credential = await this.authRepository.getLatestCredential(sender.id);
    if (credential === null || !credential.scopes.includes(gmailReadonlyScope)) {
      this.logger.warn(
        { senderId: sender.id },
        "Inbound polling skipped because the sender has no approved Gmail read scope"
      );
      return;
    }
    const configuration = this.oauthConfiguration(credential);
    const encryptionKey = this.environment.GMAIL_TOKEN_ENCRYPTION_KEY;
    if (configuration === null || encryptionKey === undefined) {
      return;
    }
    const gateway = this.createGateway(
      configuration,
      decryptGmailRefreshToken(credential.encryptedRefreshToken, encryptionKey)
    );
    const knownThreads = await this.inboundRepository.listKnownThreads(sender.id);
    if (knownThreads.length === 0) {
      return;
    }
    const cursor = await this.inboundRepository.getCursor(sender.id);
    if (cursor === null) {
      const baselineHistoryId = await gateway.currentHistoryId();
      await this.boundedResync(sender, gateway, knownThreads);
      await this.inboundRepository.advanceCursor(sender.id, baselineHistoryId);
      return;
    }
    try {
      const history = await gateway.listMessagesSince(cursor);
      const references = referencesForKnownThreads(history.messages, knownThreads);
      for (const reference of references) {
        await this.processReference(sender, gateway, reference);
      }
      await this.inboundRepository.advanceCursor(sender.id, history.historyId);
    } catch (error) {
      if (!(error instanceof GmailHistoryExpiredError)) {
        throw error;
      }
      const baselineHistoryId = await gateway.currentHistoryId();
      await this.boundedResync(sender, gateway, knownThreads);
      await this.inboundRepository.advanceCursor(sender.id, baselineHistoryId);
    }
  }

  public async tick(): Promise<void> {
    if (this.processing || !this.environment.INBOUND_PROCESSING_ENABLED) {
      return;
    }
    this.processing = true;
    try {
      const safety = await this.safetySnapshot();
      if (!safety.flags.inbound_processing_enabled || safety.globalKillSwitchActive) {
        return;
      }
      const senders = await this.authRepository.listSenders();
      for (const sender of senders) {
        if (sender.active && sender.connected && !senderIsBlocked(safety, sender.id)) {
          await this.pollSender(sender);
        }
      }
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "Unknown inbound polling error" },
        "Inbound Gmail polling failed; the cursor was not advanced"
      );
    } finally {
      this.processing = false;
    }
  }
}
