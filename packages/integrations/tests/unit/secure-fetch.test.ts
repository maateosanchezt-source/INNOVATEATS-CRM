import { describe, expect, it } from "vitest";

import {
  isPublicIpAddress,
  SecurePublicFetcher,
  type PinnedHttpRequest,
  type PinnedHttpResponse,
  type PinnedHttpTransport,
  type PublicDnsResolver,
  type ResolvedAddress,
  type SecureFetchError
} from "../../src/index.js";

class FixtureResolver implements PublicDnsResolver {
  public constructor(
    private readonly records: Readonly<Record<string, readonly ResolvedAddress[]>>
  ) {}

  public async resolve(hostname: string): Promise<readonly ResolvedAddress[]> {
    await Promise.resolve();
    return this.records[hostname] ?? [];
  }
}

class FixtureTransport implements PinnedHttpTransport {
  public readonly requests: PinnedHttpRequest[] = [];

  public constructor(private readonly routes: Readonly<Record<string, PinnedHttpResponse>>) {}

  public async get(request: PinnedHttpRequest): Promise<PinnedHttpResponse> {
    await Promise.resolve();
    this.requests.push(request);
    const response = this.routes[request.url.toString()];
    if (response === undefined) {
      throw new Error(`No fixture for ${request.url.toString()}`);
    }
    return response;
  }
}

function response(
  status: number,
  body: string,
  headers: Readonly<Record<string, string>> = {}
): PinnedHttpResponse {
  return { status, headers, body: new TextEncoder().encode(body) };
}

describe("secure public fetch", () => {
  it("classifies routable and blocked address ranges", () => {
    expect(isPublicIpAddress("93.184.216.34")).toBe(true);
    expect(isPublicIpAddress("10.0.0.1")).toBe(false);
    expect(isPublicIpAddress("169.254.169.254")).toBe(false);
    expect(isPublicIpAddress("::1")).toBe(false);
    expect(isPublicIpAddress("::ffff:7f00:1")).toBe(false);
    expect(isPublicIpAddress("::ffff:10.0.0.1")).toBe(false);
    expect(isPublicIpAddress("2001:db8::1")).toBe(false);
    expect(isPublicIpAddress("2002:5db8:d822::1")).toBe(false);
    expect(isPublicIpAddress("2001:4860:4860::8888")).toBe(true);
  });

  it("pins public DNS, respects robots, removes scripts, and hashes the snapshot", async () => {
    const transport = new FixtureTransport({
      "https://brand.com/robots.txt": response(200, "User-agent: *\nAllow: /"),
      "https://brand.com/launch": response(
        200,
        "<html><head><title>Launch &amp; waitlist</title><script>ignore()</script></head><body>Safe fact</body></html>",
        { "content-type": "text/html; charset=utf-8" }
      )
    });
    const fetcher = new SecurePublicFetcher(
      new FixtureResolver({
        "brand.com": [{ address: "93.184.216.34", family: 4 }]
      }),
      transport
    );

    const snapshot = await fetcher.fetch("https://brand.com/launch#tracking");

    expect(snapshot.finalUrl).toBe("https://brand.com/launch");
    expect(snapshot.title).toBe("Launch & waitlist");
    expect(snapshot.extractedText).toBe("Launch & waitlist Safe fact");
    expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.resolvedAddresses).toEqual(["93.184.216.34"]);
    expect(transport.requests.every((request) => request.address.address === "93.184.216.34")).toBe(
      true
    );
  });

  it("fails closed when robots disallows the path", async () => {
    const transport = new FixtureTransport({
      "https://brand.com/robots.txt": response(200, "User-agent: *\nDisallow: /private")
    });
    const fetcher = new SecurePublicFetcher(
      new FixtureResolver({
        "brand.com": [{ address: "93.184.216.34", family: 4 }]
      }),
      transport
    );

    await expect(fetcher.fetch("https://brand.com/private/launch")).rejects.toMatchObject<
      Partial<SecureFetchError>
    >({ code: "blocked_by_robots" });
    expect(transport.requests).toHaveLength(1);
  });

  it("blocks private DNS before making a request", async () => {
    const transport = new FixtureTransport({});
    const fetcher = new SecurePublicFetcher(
      new FixtureResolver({
        "brand.com": [{ address: "127.0.0.1", family: 4 }]
      }),
      transport
    );

    await expect(fetcher.fetch("https://brand.com/")).rejects.toMatchObject<
      Partial<SecureFetchError>
    >({ code: "blocked_address" });
    expect(transport.requests).toHaveLength(0);
  });

  it("revalidates redirects and rejects a redirect to a private literal", async () => {
    const transport = new FixtureTransport({
      "https://brand.com/robots.txt": response(404, ""),
      "https://brand.com/launch": response(302, "", { location: "http://127.0.0.1/admin" })
    });
    const fetcher = new SecurePublicFetcher(
      new FixtureResolver({
        "brand.com": [{ address: "93.184.216.34", family: 4 }]
      }),
      transport
    );

    await expect(fetcher.fetch("https://brand.com/launch")).rejects.toThrow(/public domain name/iu);
  });
});
