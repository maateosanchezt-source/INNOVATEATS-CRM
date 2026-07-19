import { z } from "zod";

export const outreachSequenceStatuses = [
  "pending_workflow",
  "scheduled",
  "active",
  "paused",
  "stopped",
  "completed",
  "start_failed"
] as const;
export const outreachSequenceStatusSchema = z.enum(outreachSequenceStatuses);
export type OutreachSequenceStatus = z.infer<typeof outreachSequenceStatusSchema>;

export const outboundDeliveryStatuses = [
  "scheduled",
  "sending",
  "dry_run",
  "sent",
  "blocked",
  "delivery_unknown",
  "cancelled"
] as const;
export const outboundDeliveryStatusSchema = z.enum(outboundDeliveryStatuses);
export type OutboundDeliveryStatus = z.infer<typeof outboundDeliveryStatusSchema>;

export const gmailDeliveryModes = ["dry_run", "sandbox", "production"] as const;
export const gmailDeliveryModeSchema = z.enum(gmailDeliveryModes);
export type GmailDeliveryMode = z.infer<typeof gmailDeliveryModeSchema>;

export const sequenceStopReasons = [
  "human_reply",
  "bounce",
  "unsubscribe",
  "suppressed",
  "policy_block",
  "kill_switch",
  "campaign_paused",
  "manual_cancel",
  "completed_no_response",
  "delivery_unknown"
] as const;
export const sequenceStopReasonSchema = z.enum(sequenceStopReasons);
export type SequenceStopReason = z.infer<typeof sequenceStopReasonSchema>;

export const scheduleSequenceInputSchema = z.object({
  campaignId: z.uuid(),
  senderId: z.uuid(),
  timezone: z.string().trim().min(1).max(100)
});
export type ScheduleSequenceInput = z.infer<typeof scheduleSequenceInputSchema>;

export const outreachWorkflowInputSchema = z.object({
  sequenceId: z.uuid()
});
export type OutreachWorkflowInput = z.infer<typeof outreachWorkflowInputSchema>;

export const prepareTouchResultSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("wait"),
    scheduledAt: z.iso.datetime({ offset: true })
  }),
  z.object({
    action: z.literal("send"),
    outboundMessageId: z.uuid()
  }),
  z.object({
    action: z.literal("stop"),
    reason: sequenceStopReasonSchema
  })
]);
export type PrepareTouchResult = z.infer<typeof prepareTouchResultSchema>;

export const dispatchTouchResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.enum(["dry_run", "sent"]),
    outboundMessageId: z.uuid()
  }),
  z.object({
    outcome: z.literal("blocked"),
    outboundMessageId: z.uuid(),
    reason: z.string().trim().min(1).max(500)
  }),
  z.object({
    outcome: z.literal("delivery_unknown"),
    outboundMessageId: z.uuid(),
    reason: z.string().trim().min(1).max(500)
  })
]);
export type DispatchTouchResult = z.infer<typeof dispatchTouchResultSchema>;

export interface LocalTimeParts {
  readonly weekday: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  readonly hour: number;
  readonly minute: number;
}

const localFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = localFormatterCache.get(timezone);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  localFormatterCache.set(timezone, formatter);
  return formatter;
}

export function isIanaTimezone(value: string): boolean {
  try {
    formatterFor(value).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function localTimeParts(at: Date, timezone: string): LocalTimeParts {
  if (!isIanaTimezone(timezone)) {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
  const values = Object.fromEntries(
    formatterFor(timezone)
      .formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const weekday = values.weekday;
  if (
    weekday !== "Mon" &&
    weekday !== "Tue" &&
    weekday !== "Wed" &&
    weekday !== "Thu" &&
    weekday !== "Fri" &&
    weekday !== "Sat" &&
    weekday !== "Sun"
  ) {
    throw new Error("Intl did not return a supported weekday.");
  }
  return {
    weekday,
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

export function isPreferredSendWindow(at: Date, timezone: string): boolean {
  const local = localTimeParts(at, timezone);
  const preferredDay =
    local.weekday === "Tue" || local.weekday === "Wed" || local.weekday === "Thu";
  const minutes = local.hour * 60 + local.minute;
  return preferredDay && minutes >= 9 * 60 && minutes <= 11 * 60 + 30;
}

export function nextPreferredSendWindow(after: Date, timezone: string): Date {
  if (!Number.isFinite(after.getTime())) {
    throw new Error("A valid scheduling date is required.");
  }
  if (!isIanaTimezone(timezone)) {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
  const candidate = new Date(after);
  candidate.setUTCSeconds(0, 0);
  if (candidate.getTime() < after.getTime()) {
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  const maximumMinutes = 8 * 24 * 60;
  for (let offset = 0; offset <= maximumMinutes; offset += 1) {
    if (isPreferredSendWindow(candidate, timezone)) {
      return candidate;
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw new Error("No preferred send window found within eight days.");
}

export function sequenceWorkflowId(sequenceId: string): string {
  return `outreach-sequence:${z.uuid().parse(sequenceId)}`;
}

export function outboundIdempotencyKey(
  campaignId: string,
  leadId: string,
  sequenceStep: 1 | 2 | 3
): string {
  return `${z.uuid().parse(campaignId)}:${z.uuid().parse(leadId)}:${sequenceStep}:email`;
}
