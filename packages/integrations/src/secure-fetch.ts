import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import {
  normalizePublicUrl,
  sourceSnapshotSchema,
  type PublicDocumentLink,
  type SourceSnapshot
} from "@innovateats/shared";

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface PublicDnsResolver {
  resolve(hostname: string): Promise<readonly ResolvedAddress[]>;
}

export class NodePublicDnsResolver implements PublicDnsResolver {
  public async resolve(hostname: string): Promise<readonly ResolvedAddress[]> {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.flatMap((entry) =>
      entry.family === 4 || entry.family === 6
        ? [{ address: entry.address, family: entry.family }]
        : []
    );
  }
}

export interface PinnedHttpRequest {
  readonly url: URL;
  readonly address: ResolvedAddress;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

export interface PinnedHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface PinnedHttpTransport {
  get(request: PinnedHttpRequest): Promise<PinnedHttpResponse>;
}

export class SecureFetchError extends Error {
  public constructor(
    message: string,
    public readonly code:
      | "blocked_address"
      | "blocked_by_robots"
      | "dns_failure"
      | "invalid_content"
      | "redirect_limit"
      | "response_too_large"
      | "transport_failure"
  ) {
    super(message);
    this.name = "SecureFetchError";
  }
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return value;
}

export class NodePinnedHttpTransport implements PinnedHttpTransport {
  public async get(input: PinnedHttpRequest): Promise<PinnedHttpResponse> {
    return new Promise((resolve, reject) => {
      const client = input.url.protocol === "https:" ? httpsRequest : httpRequest;
      const request = client(
        {
          protocol: input.url.protocol,
          hostname: input.address.address,
          family: input.address.family,
          port: input.url.port === "" ? undefined : input.url.port,
          method: "GET",
          path: `${input.url.pathname}${input.url.search}`,
          headers: {
            ...input.headers,
            host: input.url.host
          },
          ...(input.url.protocol === "https:"
            ? {
                servername: input.url.hostname,
                rejectUnauthorized: true
              }
            : {})
        },
        (response) => {
          const chunks: Uint8Array[] = [];
          let length = 0;

          response.on("data", (chunk: Buffer) => {
            length += chunk.byteLength;
            if (length > input.maxBytes) {
              response.destroy(
                new SecureFetchError(
                  `Response exceeded ${input.maxBytes} bytes.`,
                  "response_too_large"
                )
              );
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode ?? 0,
              headers: {
                ...(headerValue(response.headers, "content-type") === undefined
                  ? {}
                  : { "content-type": headerValue(response.headers, "content-type") as string }),
                ...(headerValue(response.headers, "content-length") === undefined
                  ? {}
                  : {
                      "content-length": headerValue(response.headers, "content-length") as string
                    }),
                ...(headerValue(response.headers, "location") === undefined
                  ? {}
                  : { location: headerValue(response.headers, "location") as string })
              },
              body: Buffer.concat(chunks)
            });
          });
          response.on("error", reject);
        }
      );

      request.setTimeout(input.timeoutMs, () => {
        request.destroy(new SecureFetchError("Public fetch timed out.", "transport_failure"));
      });
      request.on("error", reject);
      request.end();
    });
  }
}

function ipv4Octets(address: string): readonly number[] | null {
  if (isIP(address) !== 4) {
    return null;
  }
  return address.split(".").map(Number);
}

function ipv4IsPublic(address: string): boolean {
  const octets = ipv4Octets(address);
  if (octets === null) {
    return false;
  }
  const [a = 0, b = 0] = octets;

  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && octets[2] === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a >= 224
  );
}

function ipv6IsPublic(address: string): boolean {
  if (isIP(address) !== 6) {
    return false;
  }

  const words = ipv6Words(address);
  if (words === null) {
    return false;
  }

  const ipv4Mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (ipv4Mapped) {
    const high = words[6] ?? 0;
    const low = words[7] ?? 0;
    return ipv4IsPublic(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
  }

  // Only globally routable unicast is eligible. Explicitly exclude special-use
  // allocations that sit inside 2000::/3.
  return (
    prefixMatches(words, [0x2000], 3) &&
    !prefixMatches(words, [0x2001, 0x0000], 23) &&
    !prefixMatches(words, [0x2001, 0x0db8], 32) &&
    !prefixMatches(words, [0x2002], 16) &&
    !prefixMatches(words, [0x3fff, 0x0000], 20)
  );
}

export function isPublicIpAddress(address: string): boolean {
  return ipv4IsPublic(address) || ipv6IsPublic(address);
}

function ipv6Words(address: string): readonly number[] | null {
  const normalized = address.toLowerCase();
  const dottedTail = normalized.match(/(\d{1,3}(?:\.\d{1,3}){3})$/u)?.[1];
  let hexadecimal = normalized;
  if (dottedTail !== undefined) {
    const octets = ipv4Octets(dottedTail);
    if (octets === null) {
      return null;
    }
    hexadecimal = `${normalized.slice(0, -dottedTail.length)}${(
      ((octets[0] as number) << 8) |
      (octets[1] as number)
    ).toString(16)}:${(((octets[2] as number) << 8) | (octets[3] as number)).toString(16)}`;
  }

  const halves = hexadecimal.split("::");
  if (halves.length > 2) {
    return null;
  }
  const left = halves[0] === "" ? [] : (halves[0] as string).split(":");
  const right = halves.length === 1 || halves[1] === "" ? [] : (halves[1] as string).split(":");
  const fillCount = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fillCount < 0 || (halves.length === 1 && left.length !== 8)) {
    return null;
  }

  const values = [...left, ...Array.from({ length: fillCount }, () => "0"), ...right].map((word) =>
    Number.parseInt(word, 16)
  );
  return values.length === 8 &&
    values.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
    ? values
    : null;
}

function prefixMatches(
  address: readonly number[],
  network: readonly number[],
  prefixLength: number
): boolean {
  const completeWords = Math.floor(prefixLength / 16);
  const remainingBits = prefixLength % 16;
  for (let index = 0; index < completeWords; index += 1) {
    if (address[index] !== network[index]) {
      return false;
    }
  }
  if (remainingBits === 0) {
    return true;
  }
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return ((address[completeWords] ?? 0) & mask) === ((network[completeWords] ?? 0) & mask);
}

interface RobotsGroup {
  readonly agents: string[];
  readonly rules: { readonly allow: boolean; readonly path: string }[];
}

function robotsAllows(body: string, path: string, userAgent: string): boolean {
  const groups: RobotsGroup[] = [];
  let agents: string[] = [];
  let rules: { allow: boolean; path: string }[] = [];

  const flush = () => {
    if (agents.length > 0) {
      groups.push({ agents, rules });
    }
    agents = [];
    rules = [];
  };

  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    if (line === "") {
      if (rules.length > 0) {
        flush();
      }
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (rules.length > 0) {
        flush();
      }
      agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && agents.length > 0) {
      if (value !== "") {
        rules.push({ allow: field === "allow", path: value });
      }
    }
  }
  flush();

  const normalizedAgent = userAgent.toLowerCase();
  const matching = groups.filter((group) =>
    group.agents.some((agent) => agent === "*" || normalizedAgent.includes(agent))
  );
  const applicable = matching.flatMap((group) => group.rules);
  const matched = applicable
    .filter((rule) => path.startsWith(rule.path))
    .sort((left, right) => right.path.length - left.path.length)[0];

  return matched?.allow ?? true;
}

function decodeEntities(value: string): string {
  const entities: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const digits = entity.slice(hexadecimal ? 2 : 1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return entities[entity.toLowerCase()] ?? match;
  });
}

function htmlAttribute(tag: string, name: string): string | null {
  const expression = new RegExp(
    String.raw`\b${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>` + "`" + String.raw`]+))`,
    "iu"
  );
  const match = tag.match(expression);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function normalizedDocumentLink(
  rawHref: string,
  baseUrl: URL,
  kind: PublicDocumentLink["kind"],
  label: string
): PublicDocumentLink | null {
  const href = decodeEntities(rawHref).trim();
  if (href.toLowerCase().startsWith("mailto:")) {
    const address = href.slice("mailto:".length).split("?")[0]?.trim().toLowerCase();
    return address !== undefined && address !== ""
      ? { kind: "mailto", href: `mailto:${address}`, label }
      : null;
  }

  try {
    return {
      kind,
      href: normalizePublicUrl(new URL(href || baseUrl.toString(), baseUrl).toString()).url,
      label
    };
  } catch {
    return null;
  }
}

function extractPublicLinks(body: string, baseUrl: URL): readonly PublicDocumentLink[] {
  const links: PublicDocumentLink[] = [];
  const seen = new Set<string>();
  const add = (candidate: PublicDocumentLink | null) => {
    if (
      candidate === null ||
      seen.has(`${candidate.kind}:${candidate.href}`) ||
      links.length >= 200
    ) {
      return;
    }
    seen.add(`${candidate.kind}:${candidate.href}`);
    links.push(candidate);
  };

  for (const match of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const attributes = match[1] ?? "";
    const href = htmlAttribute(attributes, "href");
    if (href === null) {
      continue;
    }
    const label = decodeEntities((match[2] ?? "").replace(/<[^>]+>/gu, " "))
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 500);
    add(normalizedDocumentLink(href, baseUrl, "anchor", label));
  }

  for (const match of body.matchAll(/<form\b([^>]*)>/giu)) {
    const attributes = match[1] ?? "";
    const action = htmlAttribute(attributes, "action") ?? baseUrl.toString();
    const label = (htmlAttribute(attributes, "aria-label") ?? "Form").trim().slice(0, 500);
    add(normalizedDocumentLink(action, baseUrl, "form", label));
  }

  return links;
}

function extractHtml(
  body: string,
  maximumCharacters: number,
  baseUrl: URL
): {
  readonly title: string | null;
  readonly text: string;
  readonly publicLinks: readonly PublicDocumentLink[];
} {
  const titleMatch = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu);
  const withoutInactiveContent = body
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ");
  const text = decodeEntities(withoutInactiveContent.replace(/<[^>]+>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximumCharacters);
  const title =
    titleMatch?.[1] === undefined
      ? null
      : decodeEntities(titleMatch[1].replace(/<[^>]+>/gu, " "))
          .replace(/\s+/gu, " ")
          .trim()
          .slice(0, 500);

  return {
    title: title === "" ? null : title,
    text,
    publicLinks: extractPublicLinks(body, baseUrl)
  };
}

export interface SecurePublicFetcherOptions {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxExtractedCharacters?: number;
  readonly maxRedirects?: number;
  readonly userAgent?: string;
}

export class SecurePublicFetcher {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxExtractedCharacters: number;
  private readonly maxRedirects: number;
  private readonly userAgent: string;
  private readonly robotsCache = new Map<string, Promise<string | null>>();

  public constructor(
    private readonly resolver: PublicDnsResolver = new NodePublicDnsResolver(),
    private readonly transport: PinnedHttpTransport = new NodePinnedHttpTransport(),
    options: SecurePublicFetcherOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxBytes = options.maxBytes ?? 2_000_000;
    this.maxExtractedCharacters = options.maxExtractedCharacters ?? 200_000;
    this.maxRedirects = options.maxRedirects ?? 3;
    this.userAgent = options.userAgent ?? "InnovatEatsResearchBot/1.0 (+https://innovateats.com)";
  }

  public async fetch(rawUrl: string): Promise<SourceSnapshot> {
    const requestedUrl = normalizePublicUrl(rawUrl).url;
    let current = new URL(requestedUrl);
    const resolvedAddresses = new Set<string>();

    for (let redirectCount = 0; redirectCount <= this.maxRedirects; redirectCount += 1) {
      await this.assertRobotsAllowed(current, resolvedAddresses);
      const response = await this.request(current, this.maxBytes, resolvedAddresses);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (location === undefined) {
          throw new SecureFetchError("Redirect response omitted Location.", "transport_failure");
        }
        if (redirectCount === this.maxRedirects) {
          throw new SecureFetchError("Public fetch exceeded redirect limit.", "redirect_limit");
        }
        current = new URL(normalizePublicUrl(new URL(location, current).toString()).url);
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        throw new SecureFetchError(
          `Public fetch returned HTTP ${response.status}.`,
          "transport_failure"
        );
      }

      const contentType = (response.headers["content-type"] ?? "")
        .split(";")[0]
        ?.trim()
        .toLowerCase();
      if (
        contentType !== "text/html" &&
        contentType !== "application/xhtml+xml" &&
        contentType !== "text/plain"
      ) {
        throw new SecureFetchError(
          `Unsupported public content type: ${contentType || "missing"}.`,
          "invalid_content"
        );
      }
      if (response.body.byteLength > this.maxBytes) {
        throw new SecureFetchError(
          `Response exceeded ${this.maxBytes} bytes.`,
          "response_too_large"
        );
      }

      const rawBody = new TextDecoder("utf-8", { fatal: false }).decode(response.body);
      const extracted =
        contentType === "text/plain"
          ? {
              title: null,
              text: rawBody.trim().slice(0, this.maxExtractedCharacters),
              publicLinks: []
            }
          : extractHtml(rawBody, this.maxExtractedCharacters, current);

      return sourceSnapshotSchema.parse({
        requestedUrl,
        finalUrl: current.toString(),
        title: extracted.title,
        extractedText: extracted.text,
        contentHash: createHash("sha256").update(response.body).digest("hex"),
        contentType,
        fetchedAt: new Date().toISOString(),
        byteLength: response.body.byteLength,
        redirectCount,
        resolvedAddresses: [...resolvedAddresses],
        robotsDecision: "allowed",
        publicLinks: extracted.publicLinks
      });
    }

    throw new SecureFetchError("Public fetch exceeded redirect limit.", "redirect_limit");
  }

  private async request(
    url: URL,
    maxBytes: number,
    observedAddresses: Set<string>
  ): Promise<PinnedHttpResponse> {
    let addresses: readonly ResolvedAddress[];
    try {
      addresses = await this.resolver.resolve(url.hostname);
    } catch {
      throw new SecureFetchError("Public host DNS resolution failed.", "dns_failure");
    }

    if (addresses.length === 0 || addresses.some((entry) => !isPublicIpAddress(entry.address))) {
      throw new SecureFetchError("Public fetch resolved to a blocked address.", "blocked_address");
    }

    for (const entry of addresses) {
      observedAddresses.add(entry.address);
    }

    try {
      return await this.transport.get({
        url,
        address: addresses[0] as ResolvedAddress,
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "accept-encoding": "identity",
          "user-agent": this.userAgent
        },
        timeoutMs: this.timeoutMs,
        maxBytes
      });
    } catch (error) {
      if (error instanceof SecureFetchError) {
        throw error;
      }
      throw new SecureFetchError("Pinned public fetch failed.", "transport_failure");
    }
  }

  private async assertRobotsAllowed(url: URL, observedAddresses: Set<string>): Promise<void> {
    const origin = url.origin;
    let robotsPromise = this.robotsCache.get(origin);
    if (robotsPromise === undefined) {
      robotsPromise = this.loadRobots(new URL("/robots.txt", origin), observedAddresses);
      this.robotsCache.set(origin, robotsPromise);
    }

    const robots = await robotsPromise;
    if (robots === null) {
      return;
    }

    if (!robotsAllows(robots, `${url.pathname}${url.search}`, this.userAgent)) {
      throw new SecureFetchError("Public path is disallowed by robots.txt.", "blocked_by_robots");
    }
  }

  private async loadRobots(url: URL, observedAddresses: Set<string>): Promise<string | null> {
    const response = await this.request(url, 512_000, observedAddresses);
    if (response.status === 404 || response.status === 410) {
      return null;
    }
    if (response.status !== 200) {
      throw new SecureFetchError(
        `robots.txt could not be verified (HTTP ${response.status}).`,
        "blocked_by_robots"
      );
    }
    if (response.body.byteLength > 512_000) {
      throw new SecureFetchError("robots.txt exceeded the size limit.", "blocked_by_robots");
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(response.body);
  }
}
