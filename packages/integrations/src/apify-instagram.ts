import {
  instagramFollowerProfileSchema,
  instagramProfileSnapshotSchema,
  instagramSearchUserSchema,
  normalizeInstagramHandle,
  type InstagramFollowerProfile,
  type InstagramProfileSnapshot,
  type InstagramSearchUser
} from "@innovateats/shared";
import { z } from "zod";

const actorRunStatusSchema = z.enum([
  "READY",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "TIMED-OUT",
  "ABORTED"
]);

const actorRunEnvelopeSchema = z.object({
  data: z.object({
    id: z.string().min(1).max(200),
    defaultDatasetId: z.string().min(1).max(200),
    status: actorRunStatusSchema
  })
});

const actorDatasetSchema = z.array(z.record(z.string(), z.unknown())).max(10_000);

export interface ApifyRunReference {
  readonly runId: string;
  readonly datasetId: string;
  readonly status: z.infer<typeof actorRunStatusSchema>;
}

export interface ApifyHttpTransport {
  request(path: string, init: RequestInit): Promise<unknown>;
}

export class ApifyRequestError extends Error {
  public constructor(
    message: string,
    public readonly code:
      "authentication" | "provider_failure" | "provider_timeout" | "invalid_response"
  ) {
    super(message);
    this.name = "ApifyRequestError";
  }
}

export class FetchApifyTransport implements ApifyHttpTransport {
  public constructor(
    private readonly baseUrl: string,
    private readonly apiToken: string,
    private readonly timeoutMs = 60_000
  ) {
    if (apiToken.trim() === "") {
      throw new Error("An Apify API token is required.");
    }
  }

  public async request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref();

    try {
      const response = await fetch(new URL(path, `${this.baseUrl.replace(/\/+$/u, "")}/`), {
        ...init,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiToken}`,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...init.headers
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new ApifyRequestError(
          `Apify returned HTTP ${response.status}.`,
          response.status === 401 || response.status === 403 ? "authentication" : "provider_failure"
        );
      }
      return response.json();
    } catch (error) {
      if (error instanceof ApifyRequestError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApifyRequestError("Apify request timed out.", "provider_timeout");
      }
      throw new ApifyRequestError("Apify request failed.", "provider_failure");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface ApifyInstagramProviderConfiguration {
  readonly searchActorId: string;
  readonly profileActorId: string;
  readonly followersActorId: string;
  readonly pollIntervalMs?: number;
  readonly runTimeoutMs?: number;
}

function nullableString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, maximum) : null;
}

function nullableCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function publicUrlOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function latestPostTimestamp(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const timestamp = (item as Record<string, unknown>).timestamp;
    if (
      typeof timestamp === "string" &&
      z.iso.datetime({ offset: true }).safeParse(timestamp).success
    ) {
      return timestamp;
    }
  }
  return null;
}

export class ApifyInstagramProvider {
  private readonly pollIntervalMs: number;
  private readonly runTimeoutMs: number;

  public constructor(
    private readonly transport: ApifyHttpTransport,
    private readonly configuration: ApifyInstagramProviderConfiguration
  ) {
    this.pollIntervalMs = configuration.pollIntervalMs ?? 2_000;
    this.runTimeoutMs = configuration.runTimeoutMs ?? 5 * 60_000;
  }

  public startUserSearch(query: string, limit: number): Promise<ApifyRunReference> {
    const normalizedQuery = z.string().trim().min(2).max(200).parse(query);
    const boundedLimit = z.number().int().min(1).max(250).parse(limit);
    return this.startActor(this.configuration.searchActorId, {
      search: normalizedQuery,
      searchType: "user",
      searchLimit: boundedLimit,
      enhanceUserSearchWithFacebookPage: false,
      liveSearch: false
    });
  }

  public startProfileLookup(usernames: readonly string[]): Promise<ApifyRunReference> {
    const normalized = [...new Set(usernames.map(normalizeInstagramHandle))].slice(0, 500);
    if (normalized.length === 0) {
      throw new Error("At least one Instagram username is required.");
    }
    return this.startActor(this.configuration.profileActorId, {
      usernames: normalized,
      includeAboutSection: false
    });
  }

  public startAudienceLookup(
    username: string,
    relation: "Followers" | "Following",
    limit: number
  ): Promise<ApifyRunReference> {
    return this.startActor(this.configuration.followersActorId, {
      Account: [normalizeInstagramHandle(username)],
      resultsLimit: z.number().int().min(1).max(1_000).parse(limit),
      dataToScrape: relation
    });
  }

  public async waitForRun(reference: ApifyRunReference): Promise<ApifyRunReference> {
    let current = reference;
    const deadline = Date.now() + this.runTimeoutMs;
    while (current.status === "READY" || current.status === "RUNNING") {
      if (Date.now() >= deadline) {
        throw new ApifyRequestError("Apify actor run timed out.", "provider_timeout");
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, this.pollIntervalMs);
      });
      current = await this.getRun(reference.runId);
    }

    if (current.status !== "SUCCEEDED") {
      throw new ApifyRequestError(
        `Apify actor run ended with status ${current.status}.`,
        "provider_failure"
      );
    }
    return current;
  }

  public async readSearchUsers(
    reference: ApifyRunReference
  ): Promise<readonly InstagramSearchUser[]> {
    const items = await this.readDataset(reference.datasetId, 10_000);
    return items.flatMap((item) => {
      const username = nullableString(item.username, 30);
      const profileUrl = publicUrlOrNull(item.url);
      if (username === null || profileUrl === null) {
        return [];
      }
      const parsed = instagramSearchUserSchema.safeParse({
        providerResultId: nullableString(item.id, 200) ?? username,
        username,
        fullName: nullableString(item.fullName, 200),
        profileUrl,
        private: booleanValue(item.private),
        verified: booleanValue(item.verified)
      });
      return parsed.success ? [parsed.data] : [];
    });
  }

  public async readProfiles(
    reference: ApifyRunReference,
    observedAt = new Date().toISOString()
  ): Promise<readonly InstagramProfileSnapshot[]> {
    const items = await this.readDataset(reference.datasetId, 10_000);
    return items.flatMap((item) => {
      const username = nullableString(item.username, 30);
      const profileUrl =
        publicUrlOrNull(item.url) ??
        (username === null ? null : `https://www.instagram.com/${username}/`);
      if (username === null || profileUrl === null) {
        return [];
      }
      const parsed = instagramProfileSnapshotSchema.safeParse({
        providerResultId: nullableString(item.id, 200) ?? username,
        username,
        fullName: nullableString(item.fullName, 200),
        biography: nullableString(item.biography, 2_000),
        profileUrl,
        externalUrl: publicUrlOrNull(item.externalUrl),
        followersCount: nullableCount(item.followersCount),
        followsCount: nullableCount(item.followsCount),
        postsCount: nullableCount(item.postsCount),
        isBusinessAccount:
          typeof item.isBusinessAccount === "boolean" ? item.isBusinessAccount : null,
        businessCategory: nullableString(item.businessCategoryName, 200),
        private: booleanValue(item.private),
        verified: booleanValue(item.verified),
        latestPostAt: latestPostTimestamp(item.latestPosts),
        observedAt
      });
      return parsed.success ? [parsed.data] : [];
    });
  }

  public async readAudience(
    reference: ApifyRunReference
  ): Promise<readonly InstagramFollowerProfile[]> {
    const items = await this.readDataset(reference.datasetId, 10_000);
    return items.flatMap((item) => {
      const username = nullableString(item.username, 30);
      const sourceUsername = nullableString(item.username_scrape, 30);
      if (username === null || sourceUsername === null) {
        return [];
      }
      const parsed = instagramFollowerProfileSchema.safeParse({
        providerResultId: nullableString(item.id, 200) ?? `${sourceUsername}:${username}`,
        sourceUsername,
        username,
        fullName: nullableString(item.full_name, 200),
        private: booleanValue(item.is_private),
        verified: booleanValue(item.is_verified)
      });
      return parsed.success ? [parsed.data] : [];
    });
  }

  private async startActor(
    actorId: string,
    input: Readonly<Record<string, unknown>>
  ): Promise<ApifyRunReference> {
    const response = await this.transport.request(
      `acts/${encodeURIComponent(actorId)}/runs?waitForFinish=0`,
      {
        method: "POST",
        body: JSON.stringify(input)
      }
    );
    return this.parseRun(response);
  }

  private async getRun(runId: string): Promise<ApifyRunReference> {
    const response = await this.transport.request(`actor-runs/${encodeURIComponent(runId)}`, {
      method: "GET"
    });
    return this.parseRun(response);
  }

  private async readDataset(
    datasetId: string,
    limit: number
  ): Promise<readonly Record<string, unknown>[]> {
    const response = await this.transport.request(
      `datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${limit}`,
      { method: "GET" }
    );
    const parsed = actorDatasetSchema.safeParse(response);
    if (!parsed.success) {
      throw new ApifyRequestError("Apify dataset response was invalid.", "invalid_response");
    }
    return parsed.data;
  }

  private parseRun(response: unknown): ApifyRunReference {
    const parsed = actorRunEnvelopeSchema.safeParse(response);
    if (!parsed.success) {
      throw new ApifyRequestError("Apify actor response was invalid.", "invalid_response");
    }
    return {
      runId: parsed.data.data.id,
      datasetId: parsed.data.data.defaultDatasetId,
      status: parsed.data.data.status
    };
  }
}
