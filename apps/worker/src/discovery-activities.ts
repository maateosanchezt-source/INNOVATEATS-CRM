import { createHash } from "node:crypto";

import type { ServerEnvironment } from "@innovateats/config";
import {
  PostgresDiscoveryRepository,
  type AppDatabase,
  type DiscoveryRunContext,
  type DiscoverySeedRecord,
  type ProviderActionRecord
} from "@innovateats/db";
import {
  ApifyInstagramProvider,
  ApifyRequestError,
  FetchApifyTransport,
  type ApifyRunReference
} from "@innovateats/integrations";
import type {
  DiscoveryTrack,
  InstagramFollowerProfile,
  InstagramProfileSnapshot,
  InstagramSearchUser
} from "@innovateats/shared";
import type { DiscoveryActivities } from "@innovateats/workflows";

interface CandidateOrigin {
  readonly track: DiscoveryTrack;
  readonly sources: { readonly seedId: string; readonly providerResultId: string }[];
}

function inputHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function errorCode(error: unknown): string {
  return error instanceof ApifyRequestError ? `apify_${error.code}` : "discovery_execution_failed";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Instagram discovery failed.";
}

function runReference(action: ProviderActionRecord): ApifyRunReference {
  if (action.providerRunId === null || action.datasetId === null) {
    throw new Error("Persisted provider action has no run reference.");
  }
  return {
    runId: action.providerRunId,
    datasetId: action.datasetId,
    status: action.status === "succeeded" ? "SUCCEEDED" : "RUNNING"
  };
}

export class InstagramDiscoveryActivityService implements DiscoveryActivities {
  private readonly repository: PostgresDiscoveryRepository;
  private readonly provider: ApifyInstagramProvider;

  public constructor(
    database: AppDatabase,
    private readonly environment: ServerEnvironment
  ) {
    if (!environment.DISCOVERY_ENABLED || environment.APIFY_API_TOKEN === undefined) {
      throw new Error("Instagram discovery is not configured.");
    }
    this.repository = new PostgresDiscoveryRepository(database);
    this.provider = new ApifyInstagramProvider(
      new FetchApifyTransport(environment.APIFY_API_BASE_URL, environment.APIFY_API_TOKEN),
      {
        searchActorId: environment.APIFY_INSTAGRAM_SEARCH_ACTOR_ID,
        profileActorId: environment.APIFY_INSTAGRAM_PROFILE_ACTOR_ID,
        followersActorId: environment.APIFY_INSTAGRAM_FOLLOWERS_ACTOR_ID
      }
    );
  }

  public async executeInstagramDiscovery(runId: string): Promise<void> {
    try {
      await this.repository.startRun(runId);
      const context = await this.repository.getRunContext(runId);
      const capacity = Math.min(context.remainingTarget, context.remainingDailyCapacity);
      if (capacity === 0) {
        await this.repository.completeRun(runId, {
          candidates: [],
          discoveredCount: 0
        });
        return;
      }

      const origins = new Map<string, CandidateOrigin>();
      for (const seed of context.seeds) {
        if (origins.size >= capacity) {
          break;
        }
        const limit = Math.min(context.campaign.resultsPerSeed, capacity - origins.size);
        const results = await this.discoverFromSeed(context, seed, limit);
        for (const result of results) {
          const existing = origins.get(result.username);
          if (existing === undefined) {
            origins.set(result.username, {
              track: seed.track,
              sources: [{ seedId: seed.id, providerResultId: result.providerResultId }]
            });
          } else if (!existing.sources.some((source) => source.seedId === seed.id)) {
            existing.sources.push({
              seedId: seed.id,
              providerResultId: result.providerResultId
            });
          }
          if (origins.size >= capacity) {
            break;
          }
        }
      }

      const usernames = [...origins.keys()];
      if (usernames.length === 0) {
        await this.repository.completeRun(runId, {
          candidates: [],
          discoveredCount: 0
        });
        return;
      }
      const profiles = await this.enrichProfiles(context, usernames);
      await this.repository.completeRun(runId, {
        candidates: profiles.flatMap((profile) => {
          const origin = origins.get(profile.username);
          return origin === undefined
            ? []
            : [
                {
                  profile,
                  track: origin.track,
                  sources: origin.sources
                }
              ];
        }),
        discoveredCount: origins.size
      });
    } catch (error) {
      await this.repository.failRun(runId, errorCode(error), errorMessage(error));
      throw error;
    }
  }

  private async discoverFromSeed(
    context: DiscoveryRunContext,
    seed: DiscoverySeedRecord,
    limit: number
  ): Promise<readonly (InstagramSearchUser | InstagramFollowerProfile)[]> {
    if (seed.kind === "keyword" || seed.kind === "hashtag") {
      const query = seed.kind === "hashtag" ? `#${seed.normalizedValue}` : seed.value;
      const action = await this.executeAction({
        runId: context.run.id,
        seed,
        actionKey: `${context.run.id}:seed:${seed.id}`,
        actorId: this.environment.APIFY_INSTAGRAM_SEARCH_ACTOR_ID,
        input: { query, limit, kind: seed.kind },
        start: () => this.provider.startUserSearch(query, limit)
      });
      return this.readAndComplete(action, (reference) => this.provider.readSearchUsers(reference));
    }

    const relation = seed.kind === "profile_followers" ? "Followers" : "Following";
    const action = await this.executeAction({
      runId: context.run.id,
      seed,
      actionKey: `${context.run.id}:seed:${seed.id}`,
      actorId: this.environment.APIFY_INSTAGRAM_FOLLOWERS_ACTOR_ID,
      input: { username: seed.normalizedValue, relation, limit },
      start: () => this.provider.startAudienceLookup(seed.normalizedValue, relation, limit)
    });
    return this.readAndComplete(action, (reference) => this.provider.readAudience(reference));
  }

  private async enrichProfiles(
    context: DiscoveryRunContext,
    usernames: readonly string[]
  ): Promise<readonly InstagramProfileSnapshot[]> {
    const hash = inputHash([...usernames].sort());
    const action = await this.executeAction({
      runId: context.run.id,
      actionKey: `${context.run.id}:profiles:${hash.slice(0, 16)}`,
      actorId: this.environment.APIFY_INSTAGRAM_PROFILE_ACTOR_ID,
      input: { usernames: [...usernames].sort() },
      start: () => this.provider.startProfileLookup(usernames)
    });
    return this.readAndComplete(action, (reference) => this.provider.readProfiles(reference));
  }

  private async executeAction(input: {
    readonly runId: string;
    readonly seed?: DiscoverySeedRecord;
    readonly actionKey: string;
    readonly actorId: string;
    readonly input: unknown;
    readonly start: () => Promise<ApifyRunReference>;
  }): Promise<ProviderActionRecord> {
    const claimed = await this.repository.claimProviderAction({
      runId: input.runId,
      ...(input.seed === undefined ? {} : { seedId: input.seed.id }),
      actionKey: input.actionKey,
      actorId: input.actorId,
      inputHash: inputHash(input.input)
    });
    if (claimed.status === "running" || claimed.status === "succeeded") {
      return claimed;
    }
    if (!claimed.created || claimed.status !== "claimed") {
      if (claimed.status === "claimed") {
        await this.repository.failProviderAction(
          claimed.id,
          "provider_start_outcome_unknown",
          true
        );
      }
      throw new Error("Provider action requires manual reconciliation.");
    }

    let reference: ApifyRunReference;
    try {
      reference = await input.start();
    } catch (error) {
      await this.repository.failProviderAction(claimed.id, errorCode(error), true);
      throw error;
    }
    return this.repository.markProviderActionStarted(
      claimed.id,
      reference.runId,
      reference.datasetId
    );
  }

  private async readAndComplete<T>(
    action: ProviderActionRecord,
    read: (reference: ApifyRunReference) => Promise<readonly T[]>
  ): Promise<readonly T[]> {
    const reference = runReference(action);
    try {
      const completed =
        action.status === "succeeded" ? reference : await this.provider.waitForRun(reference);
      const items = await read(completed);
      if (action.status !== "succeeded") {
        await this.repository.completeProviderAction(action.id, items.length);
      }
      return items;
    } catch (error) {
      await this.repository.failProviderAction(action.id, errorCode(error), false);
      throw error;
    }
  }
}

export function createDiscoveryActivities(
  database: AppDatabase,
  environment: ServerEnvironment
): DiscoveryActivities {
  const service = new InstagramDiscoveryActivityService(database, environment);
  return {
    executeInstagramDiscovery: (runId) => service.executeInstagramDiscovery(runId)
  };
}
