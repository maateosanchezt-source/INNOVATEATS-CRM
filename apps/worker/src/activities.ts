import type { ServerEnvironment } from "@innovateats/config";
import {
  PostgresGmailAuthRepository,
  PostgresOutreachRepository,
  type AppDatabase,
  type RuntimeSendGate
} from "@innovateats/db";
import {
  decryptGmailRefreshToken,
  GoogleGmailGateway,
  renderOutboundBody
} from "@innovateats/integrations";
import type { DispatchTouchResult, SequenceStopReason } from "@innovateats/shared";
import type { OutreachActivities } from "@innovateats/workflows";

function runtimeGate(environment: ServerEnvironment): RuntimeSendGate {
  return {
    configuredMode: environment.GMAIL_DELIVERY_MODE,
    environmentDryRun: environment.GLOBAL_DRY_RUN,
    environmentEmailSendEnabled: environment.EMAIL_SEND_ENABLED,
    productionSendApproved: environment.PRODUCTION_SEND_APPROVED,
    sandboxSendApproved: environment.GMAIL_SANDBOX_SEND_APPROVED,
    authorizedEmail: environment.AUTHORIZED_EMAIL,
    sandboxRecipient: environment.GMAIL_SANDBOX_RECIPIENT,
    businessContactEmail: environment.BUSINESS_CONTACT_EMAIL,
    businessPostalAddress: environment.BUSINESS_POSTAL_ADDRESS,
    globalDailyCap: environment.DAILY_EMAIL_CAP,
    externalIntegrationConfigured:
      environment.GMAIL_OAUTH_CLIENT_ID !== undefined &&
      environment.GMAIL_OAUTH_CLIENT_SECRET !== undefined &&
      environment.GMAIL_OAUTH_REDIRECT_URI !== undefined &&
      environment.GMAIL_OAUTH_REDIRECT_URI !== "" &&
      environment.GMAIL_TOKEN_ENCRYPTION_KEY !== undefined
  };
}

export function createOutreachActivities(
  database: AppDatabase,
  environment: ServerEnvironment
): OutreachActivities {
  const outreach = new PostgresOutreachRepository(database);
  const gmailAuth = new PostgresGmailAuthRepository(database);

  return {
    markWorkflowStarted: async (sequenceId) => {
      await outreach.markWorkflowStarted(sequenceId);
    },
    prepareTouch: async (sequenceId, step) => outreach.prepareTouch(sequenceId, step),
    dispatchTouch: async (sequenceId, outboundMessageId): Promise<DispatchTouchResult> => {
      const claimed = await outreach.claimOutbound(
        sequenceId,
        outboundMessageId,
        runtimeGate(environment)
      );
      if (claimed.outcome === "blocked") {
        return {
          outcome: "blocked",
          outboundMessageId,
          reason: claimed.reason
        };
      }

      const message = claimed.message;
      if (message.mode === "dry_run") {
        await outreach.completeOutbound(outboundMessageId, "dry_run", {
          decisionTrace: {
            ...message.decisionTrace,
            externalAction: false,
            completedAt: new Date().toISOString()
          }
        });
        return { outcome: "dry_run", outboundMessageId };
      }

      try {
        const credential = await gmailAuth.getLatestCredential(message.senderId);
        if (
          credential === null ||
          environment.GMAIL_TOKEN_ENCRYPTION_KEY === undefined ||
          environment.GMAIL_OAUTH_CLIENT_ID === undefined ||
          environment.GMAIL_OAUTH_CLIENT_SECRET === undefined ||
          environment.GMAIL_OAUTH_REDIRECT_URI === undefined ||
          environment.GMAIL_OAUTH_REDIRECT_URI === ""
        ) {
          throw new Error("Gmail credential or OAuth configuration became unavailable.");
        }
        const refreshToken = decryptGmailRefreshToken(
          credential.encryptedRefreshToken,
          environment.GMAIL_TOKEN_ENCRYPTION_KEY
        );
        const gateway = new GoogleGmailGateway(
          {
            clientId: environment.GMAIL_OAUTH_CLIENT_ID,
            clientSecret: environment.GMAIL_OAUTH_CLIENT_SECRET,
            redirectUri: environment.GMAIL_OAUTH_REDIRECT_URI,
            senderEmail: message.senderEmail,
            inboundReadonlyApproved: environment.GMAIL_INBOUND_OAUTH_APPROVED
          },
          refreshToken
        );
        const sent = await gateway.send({
          to: message.recipientEmail,
          from: message.senderEmail,
          subject: message.subject,
          body: renderOutboundBody(message.body, {
            contactEmail: message.businessContactEmail,
            ...(message.physicalPostalAddress === null
              ? {}
              : { physicalPostalAddress: message.physicalPostalAddress }),
            advertisementDisclosure: message.advertisementDisclosure
          }),
          internetMessageId: message.internetMessageId,
          threadId: message.threadId,
          inReplyTo: message.inReplyTo,
          references: message.references
        });
        await outreach.completeOutbound(outboundMessageId, "sent", {
          providerMessageId: sent.providerMessageId,
          threadId: sent.threadId,
          decisionTrace: {
            ...message.decisionTrace,
            provider: "gmail",
            completedAt: new Date().toISOString()
          }
        });
        return { outcome: "sent", outboundMessageId };
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "Gmail delivery outcome is unknown.";
        await outreach.completeOutbound(outboundMessageId, "delivery_unknown", {
          error: reason,
          decisionTrace: {
            ...message.decisionTrace,
            provider: "gmail",
            automaticRetry: false,
            completedAt: new Date().toISOString()
          }
        });
        return { outcome: "delivery_unknown", outboundMessageId, reason };
      }
    },
    stopSequence: async (sequenceId: string, reason: SequenceStopReason) => {
      await outreach.stopSequence(sequenceId, reason);
    },
    completeSequence: async (sequenceId) => {
      await outreach.completeSequence(sequenceId);
    }
  };
}
