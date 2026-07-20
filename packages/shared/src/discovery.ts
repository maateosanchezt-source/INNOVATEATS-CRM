import { z } from "zod";

import { researchRegionCodeSchema } from "./research.js";

export const discoveryTracks = ["food_brand", "dropshipping_founder"] as const;
export const discoveryTrackSchema = z.enum(discoveryTracks);
export type DiscoveryTrack = z.infer<typeof discoveryTrackSchema>;

export const discoverySeedKinds = [
  "keyword",
  "hashtag",
  "profile_followers",
  "profile_following"
] as const;
export const discoverySeedKindSchema = z.enum(discoverySeedKinds);
export type DiscoverySeedKind = z.infer<typeof discoverySeedKindSchema>;

const instagramHandlePattern = /^[a-z0-9._]{1,30}$/u;

export function normalizeInstagramHandle(value: string): string {
  const normalized = value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?instagram\.com\//iu, "")
    .replace(/^@/u, "")
    .replace(/\/.*$/u, "")
    .toLowerCase();
  if (!instagramHandlePattern.test(normalized)) {
    throw new Error("A valid public Instagram username is required.");
  }
  return normalized;
}

export const discoverySeedInputSchema = z
  .object({
    kind: discoverySeedKindSchema,
    value: z.string().trim().min(1).max(200),
    track: discoveryTrackSchema,
    priority: z.coerce.number().int().min(1).max(100).default(50)
  })
  .transform((seed) => ({
    ...seed,
    value:
      seed.kind === "profile_followers" || seed.kind === "profile_following"
        ? normalizeInstagramHandle(seed.value)
        : seed.value
  }));
export type DiscoverySeedInput = z.infer<typeof discoverySeedInputSchema>;

export const createDiscoveryCampaignSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    regionCode: researchRegionCodeSchema.default("ES"),
    targetCandidates: z.coerce.number().int().min(1).max(5_000).default(500),
    dailyCandidateCap: z.coerce.number().int().min(10).max(500).default(100),
    resultsPerSeed: z.coerce.number().int().min(5).max(250).default(25),
    minFollowers: z.coerce.number().int().min(0).max(10_000_000).default(50),
    maxFollowers: z.coerce.number().int().min(1).max(10_000_000).default(50_000),
    activeWithinDays: z.coerce.number().int().min(1).max(365).default(90),
    scheduleIntervalHours: z.coerce.number().int().min(1).max(168).default(24),
    autoSchedule: z.boolean().default(false),
    seeds: z.array(discoverySeedInputSchema).min(1).max(50)
  })
  .superRefine((campaign, context) => {
    if (campaign.maxFollowers < campaign.minFollowers) {
      context.addIssue({
        code: "custom",
        message: "Maximum followers must be greater than or equal to minimum followers.",
        path: ["maxFollowers"]
      });
    }

    const keys = campaign.seeds.map(
      (seed) => `${seed.kind}:${seed.track}:${seed.value.toLowerCase()}`
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        message: "Discovery seeds must be unique within a campaign.",
        path: ["seeds"]
      });
    }
  });
export type CreateDiscoveryCampaignInput = z.infer<typeof createDiscoveryCampaignSchema>;

export const discoveryCampaignStatuses = ["active", "paused", "completed"] as const;
export const discoveryCampaignStatusSchema = z.enum(discoveryCampaignStatuses);
export type DiscoveryCampaignStatus = z.infer<typeof discoveryCampaignStatusSchema>;

export const discoveryRunStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
] as const;
export const discoveryRunStatusSchema = z.enum(discoveryRunStatuses);
export type DiscoveryRunStatus = z.infer<typeof discoveryRunStatusSchema>;

export const discoveryRunTriggers = ["manual", "schedule"] as const;
export const discoveryRunTriggerSchema = z.enum(discoveryRunTriggers);
export type DiscoveryRunTrigger = z.infer<typeof discoveryRunTriggerSchema>;

export const discoveryCandidateStatuses = [
  "needs_review",
  "approved",
  "rejected",
  "imported",
  "duplicate"
] as const;
export const discoveryCandidateStatusSchema = z.enum(discoveryCandidateStatuses);
export type DiscoveryCandidateStatus = z.infer<typeof discoveryCandidateStatusSchema>;

export const discoveryCandidateDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(3).max(500)
});
export type DiscoveryCandidateDecision = z.infer<typeof discoveryCandidateDecisionSchema>;

export const queueDiscoveryRunSchema = z.object({
  trigger: discoveryRunTriggerSchema.default("manual")
});
export type QueueDiscoveryRunInput = z.infer<typeof queueDiscoveryRunSchema>;

export const instagramSearchUserSchema = z.object({
  providerResultId: z.string().trim().min(1).max(200),
  username: z.string().trim().toLowerCase().regex(instagramHandlePattern),
  fullName: z.string().trim().max(200).nullable(),
  profileUrl: z.url().max(2_048),
  private: z.boolean(),
  verified: z.boolean()
});
export type InstagramSearchUser = z.infer<typeof instagramSearchUserSchema>;

const nullableBoundedString = (maximum: number) =>
  z.string().trim().max(maximum).nullable().default(null);
const nullableCount = z.number().int().nonnegative().nullable().default(null);

export const instagramProfileSnapshotSchema = z.object({
  providerResultId: z.string().trim().min(1).max(200),
  username: z.string().trim().toLowerCase().regex(instagramHandlePattern),
  fullName: nullableBoundedString(200),
  biography: nullableBoundedString(2_000),
  profileUrl: z.url().max(2_048),
  externalUrl: z.url().max(2_048).nullable().default(null),
  followersCount: nullableCount,
  followsCount: nullableCount,
  postsCount: nullableCount,
  isBusinessAccount: z.boolean().nullable().default(null),
  businessCategory: nullableBoundedString(200),
  private: z.boolean(),
  verified: z.boolean(),
  latestPostAt: z.iso.datetime({ offset: true }).nullable().default(null),
  observedAt: z.iso.datetime({ offset: true })
});
export type InstagramProfileSnapshot = z.infer<typeof instagramProfileSnapshotSchema>;

export const instagramFollowerProfileSchema = z.object({
  providerResultId: z.string().trim().min(1).max(200),
  sourceUsername: z.string().trim().toLowerCase().regex(instagramHandlePattern),
  username: z.string().trim().toLowerCase().regex(instagramHandlePattern),
  fullName: nullableBoundedString(200),
  private: z.boolean(),
  verified: z.boolean()
});
export type InstagramFollowerProfile = z.infer<typeof instagramFollowerProfileSchema>;

export const discoveryWorkflowInputSchema = z.object({
  runId: z.uuid()
});
export type DiscoveryWorkflowInput = z.infer<typeof discoveryWorkflowInputSchema>;

export function discoveryWorkflowId(runId: string): string {
  return `instagram-discovery:${z.uuid().parse(runId)}`;
}
