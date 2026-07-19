import { describe, expect, it } from "vitest";

import { FixtureSearchProvider } from "../../src/index.js";

describe("fixture search provider", () => {
  it("paginates bounded regional fixtures", async () => {
    const provider = new FixtureSearchProvider({
      US: Array.from({ length: 3 }, (_, index) => ({
        providerResultId: `fixture-${index}`,
        title: `Fixture ${index}`,
        url: `https://fixture${index}.com/`,
        snippet: "Synthetic search result."
      }))
    });

    const first = await provider.search({
      regionCode: "US",
      query: "functional food launch",
      limit: 2
    });
    const second = await provider.search({
      regionCode: "US",
      query: "functional food launch",
      limit: 2,
      cursor: first.nextCursor
    });

    expect(first.results).toHaveLength(2);
    expect(first.nextCursor).toBe("2");
    expect(second.results).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
  });
});
