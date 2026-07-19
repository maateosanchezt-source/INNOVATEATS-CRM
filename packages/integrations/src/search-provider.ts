import {
  publicSearchPageSchema,
  publicSearchRequestSchema,
  type PublicSearchPage,
  type PublicSearchRequest,
  type PublicSearchResult,
  type ResearchRegionCode
} from "@innovateats/shared";

export interface SearchProvider {
  readonly name: string;
  search(request: PublicSearchRequest): Promise<PublicSearchPage>;
}

export class SearchProviderDisabledError extends Error {
  public constructor(provider: string) {
    super(`Search provider "${provider}" is not enabled.`);
    this.name = "SearchProviderDisabledError";
  }
}

export class DisabledSearchProvider implements SearchProvider {
  public readonly name = "disabled";

  public async search(): Promise<PublicSearchPage> {
    await Promise.resolve();
    throw new SearchProviderDisabledError(this.name);
  }
}

export class FixtureSearchProvider implements SearchProvider {
  public readonly name = "fixture";

  public constructor(
    private readonly fixtures: Readonly<
      Partial<Record<ResearchRegionCode, readonly PublicSearchResult[]>>
    >
  ) {}

  public async search(rawRequest: PublicSearchRequest): Promise<PublicSearchPage> {
    await Promise.resolve();
    const request = publicSearchRequestSchema.parse(rawRequest);
    const offset = request.cursor === undefined ? 0 : Number.parseInt(request.cursor, 10);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error("Fixture search cursor is invalid.");
    }

    const available = this.fixtures[request.regionCode] ?? [];
    const results = available.slice(offset, offset + request.limit);
    const nextOffset = offset + results.length;

    return publicSearchPageSchema.parse({
      results,
      ...(nextOffset < available.length ? { nextCursor: String(nextOffset) } : {})
    });
  }
}
