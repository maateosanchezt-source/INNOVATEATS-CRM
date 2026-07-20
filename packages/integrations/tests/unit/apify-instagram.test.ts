import { describe, expect, it, vi } from "vitest";

import {
  ApifyInstagramProvider,
  type ApifyHttpTransport,
  type ApifyRunReference
} from "../../src/index.js";

function provider(transport: ApifyHttpTransport): ApifyInstagramProvider {
  return new ApifyInstagramProvider(transport, {
    searchActorId: "apify~instagram-search-scraper",
    profileActorId: "apify~instagram-profile-scraper",
    followersActorId: "community~followers",
    pollIntervalMs: 1,
    runTimeoutMs: 100
  });
}

describe("Apify Instagram provider", () => {
  it("starts bounded searches and drops malformed provider rows", async () => {
    const request = vi
      .fn<ApifyHttpTransport["request"]>()
      .mockResolvedValueOnce({
        data: { id: "run-1", defaultDatasetId: "dataset-1", status: "SUCCEEDED" }
      })
      .mockResolvedValueOnce([
        {
          id: "123",
          username: "brand.es",
          fullName: "Brand ES",
          url: "https://www.instagram.com/brand.es/",
          private: false,
          verified: false
        },
        { url: "https://www.google.com/search?q=ignored" }
      ]);

    const integration = provider({ request });
    const run = await integration.startUserSearch("snack saludable España", 25);
    const users = await integration.readSearchUsers(run);

    expect(users).toHaveLength(1);
    expect(users[0]?.username).toBe("brand.es");
    expect(request.mock.calls[0]?.[0]).toContain("apify~instagram-search-scraper");
    expect(request.mock.calls[0]?.[1].body).toContain('"enhanceUserSearchWithFacebookPage":false');
  });

  it("maps only approved public profile fields and never stores provider email fields", async () => {
    const request = vi.fn<ApifyHttpTransport["request"]>().mockResolvedValue([
      {
        id: "profile-1",
        username: "myplesh",
        fullName: "PLESH",
        biography: "Chocolate snacks",
        followersCount: 2_500,
        followsCount: 200,
        postsCount: 50,
        externalUrl: "https://myplesh.com",
        businessEmail: "must-not-enter-the-snapshot@example.com",
        isBusinessAccount: true,
        private: false,
        verified: false,
        url: "https://www.instagram.com/myplesh/",
        latestPosts: [{ timestamp: "2026-07-19T10:00:00.000Z" }]
      }
    ]);
    const run: ApifyRunReference = {
      runId: "run-profile",
      datasetId: "dataset-profile",
      status: "SUCCEEDED"
    };

    const [profile] = await provider({ request }).readProfiles(run, "2026-07-20T10:00:00.000Z");

    expect(profile?.username).toBe("myplesh");
    expect(profile?.latestPostAt).toBe("2026-07-19T10:00:00.000Z");
    expect(profile).not.toHaveProperty("businessEmail");
  });

  it("polls an asynchronous actor run to a terminal state", async () => {
    const request = vi
      .fn<ApifyHttpTransport["request"]>()
      .mockResolvedValueOnce({
        data: { id: "run-2", defaultDatasetId: "dataset-2", status: "RUNNING" }
      })
      .mockResolvedValueOnce({
        data: { id: "run-2", defaultDatasetId: "dataset-2", status: "SUCCEEDED" }
      });
    const integration = provider({ request });

    const started = await integration.startAudienceLookup("seed.account", "Followers", 100);
    const finished = await integration.waitForRun(started);

    expect(finished.status).toBe("SUCCEEDED");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
