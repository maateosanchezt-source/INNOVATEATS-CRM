import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

import { google } from "googleapis";
import { z } from "zod";

import { INNOVATEATS_WEBSITE } from "@innovateats/shared";
import { inboundMessageSchema, type InboundMessage } from "@innovateats/shared";

export const gmailSendScope = "https://www.googleapis.com/auth/gmail.send";
export const gmailReadonlyScope = "https://www.googleapis.com/auth/gmail.readonly";
export const gmailIdentityScopes = ["openid", "email", gmailSendScope] as const;
export const gmailInboundIdentityScopes = [
  "openid",
  "email",
  gmailSendScope,
  gmailReadonlyScope
] as const;

export interface GmailOAuthConfiguration {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly senderEmail: string;
  readonly inboundReadonlyApproved?: boolean;
}

export interface GmailOAuthGrant {
  readonly senderEmail: string;
  readonly refreshToken: string;
  readonly scopes: readonly string[];
}

export interface GmailSendInput {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly body: string;
  readonly internetMessageId: string;
  readonly threadId: string | null;
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
}

export interface GmailSendResult {
  readonly providerMessageId: string;
  readonly threadId: string;
}

export interface GmailGateway {
  send(input: GmailSendInput): Promise<GmailSendResult>;
}

export interface GmailMessageReference {
  readonly providerMessageId: string;
  readonly threadId: string;
}

export interface GmailHistoryResult {
  readonly historyId: string;
  readonly messages: readonly GmailMessageReference[];
}

export interface GmailInboundGateway {
  currentHistoryId(): Promise<string>;
  listMessagesSince(historyId: string): Promise<GmailHistoryResult>;
  listThreadMessages(threadId: string): Promise<readonly GmailMessageReference[]>;
  getInboundMessage(providerMessageId: string): Promise<InboundMessage>;
}

export class GmailHistoryExpiredError extends Error {
  public constructor() {
    super("Gmail history cursor expired and requires a bounded thread resynchronization.");
    this.name = "GmailHistoryExpiredError";
  }
}

export class GmailMessageIgnoredError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GmailMessageIgnoredError";
  }
}

function encryptionKey(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    throw new Error("Gmail token encryption key must decode to exactly 32 bytes.");
  }
  return decoded;
}

export function encryptGmailRefreshToken(refreshToken: string, base64Key: string): string {
  if (refreshToken.trim() === "") {
    throw new Error("A Gmail refresh token is required.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(base64Key), iv);
  const ciphertext = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

export function decryptGmailRefreshToken(encrypted: string, base64Key: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] = encrypted.split(".");
  if (
    version !== "v1" ||
    encodedIv === undefined ||
    encodedTag === undefined ||
    encodedCiphertext === undefined ||
    extra !== undefined
  ) {
    throw new Error("Encrypted Gmail credential has an unsupported format.");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(base64Key),
      Buffer.from(encodedIv, "base64url")
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error("Encrypted Gmail credential could not be decrypted.");
  }
}

function oauthClient(configuration: GmailOAuthConfiguration) {
  return new google.auth.OAuth2(
    configuration.clientId,
    configuration.clientSecret,
    configuration.redirectUri
  );
}

export class GoogleGmailOAuth {
  public constructor(private readonly configuration: GmailOAuthConfiguration) {
    z.email().parse(configuration.senderEmail);
  }

  public authorizationUrl(state: string): string {
    if (state.trim() === "") {
      throw new Error("OAuth state is required.");
    }
    const scopes = this.configuration.inboundReadonlyApproved
      ? gmailInboundIdentityScopes
      : gmailIdentityScopes;
    return oauthClient(this.configuration).generateAuthUrl({
      access_type: "offline",
      include_granted_scopes: true,
      prompt: "consent",
      scope: [...scopes],
      state
    });
  }

  public async exchangeCode(code: string): Promise<GmailOAuthGrant> {
    if (code.trim() === "") {
      throw new Error("OAuth authorization code is required.");
    }
    const client = oauthClient(this.configuration);
    const { tokens } = await client.getToken(code);
    const refreshToken = tokens.refresh_token;
    const idToken = tokens.id_token;
    if (
      refreshToken === undefined ||
      refreshToken === null ||
      idToken === undefined ||
      idToken === null
    ) {
      throw new Error("Gmail OAuth did not return the required offline identity grant.");
    }
    const ticket = await client.verifyIdToken({
      idToken,
      audience: this.configuration.clientId
    });
    const payload = ticket.getPayload();
    const email = payload?.email?.trim().toLowerCase();
    const expected = this.configuration.senderEmail.trim().toLowerCase();
    if (payload?.email_verified !== true || email === undefined) {
      throw new Error("Gmail OAuth identity is not a verified email.");
    }
    const left = Buffer.from(email);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new Error("Gmail OAuth identity does not match the configured sender.");
    }
    const scopes = this.configuration.inboundReadonlyApproved
      ? gmailInboundIdentityScopes
      : gmailIdentityScopes;
    return {
      senderEmail: email,
      refreshToken,
      scopes: [...scopes]
    };
  }
}

function safeHeader(value: string, label: string): string {
  if (/[\r\n]/u.test(value)) {
    throw new Error(`${label} contains a forbidden line break.`);
  }
  return value;
}

function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

function wrappedBase64(value: string): string {
  return (
    Buffer.from(value, "utf8")
      .toString("base64")
      .match(/.{1,76}/gu)
      ?.join("\r\n") ?? ""
  );
}

export function buildRawGmailMessage(input: GmailSendInput): string {
  const to = z.email().parse(input.to);
  const from = z.email().parse(input.from);
  const messageId = safeHeader(input.internetMessageId, "Message-ID");
  if (!/^<[^<>\s]+@[^<>\s]+>$/u.test(messageId)) {
    throw new Error("Message-ID must use RFC angle-bracket form.");
  }
  const headers = [
    `From: Mateo Sanchez / InnovatEats <${safeHeader(from, "From")}>`,
    `To: ${safeHeader(to, "To")}`,
    `Subject: ${encodeSubject(safeHeader(input.subject, "Subject"))}`,
    `Message-ID: ${messageId}`,
    ...(input.inReplyTo === null
      ? []
      : [`In-Reply-To: ${safeHeader(input.inReplyTo, "In-Reply-To")}`]),
    ...(input.references.length === 0
      ? []
      : [
          `References: ${input.references.map((value) => safeHeader(value, "References")).join(" ")}`
        ]),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64"
  ];
  const mime = `${headers.join("\r\n")}\r\n\r\n${wrappedBase64(input.body)}\r\n`;
  return Buffer.from(mime, "utf8").toString("base64url");
}

export function outboundInternetMessageId(idempotencyKey: string): string {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex");
  return `<${digest}@outreach.innovateats.com>`;
}

export interface OutboundFooterOptions {
  readonly contactEmail?: string;
  readonly physicalPostalAddress?: string;
  readonly advertisementDisclosure?: boolean;
}

export function renderOutboundBody(
  approvedBody: string,
  options: OutboundFooterOptions = {}
): string {
  if (!approvedBody.includes(INNOVATEATS_WEBSITE)) {
    throw new Error(`Approved body must contain ${INNOVATEATS_WEBSITE}.`);
  }
  const footer = [
    "Mateo Sanchez / InnovatEats",
    ...(options.advertisementDisclosure === true ? ["Commercial introduction"] : []),
    INNOVATEATS_WEBSITE,
    ...(options.contactEmail === undefined ? [] : [options.contactEmail]),
    ...(options.physicalPostalAddress === undefined ? [] : [options.physicalPostalAddress]),
    'If this is not relevant, reply "no" and I will not contact you again.'
  ];
  return `${approvedBody.trim()}\n\n${footer.join("\n")}`;
}

export class GoogleGmailGateway implements GmailGateway {
  public constructor(
    private readonly configuration: GmailOAuthConfiguration,
    private readonly refreshToken: string
  ) {}

  public async send(input: GmailSendInput): Promise<GmailSendResult> {
    const client = oauthClient(this.configuration);
    client.setCredentials({ refresh_token: this.refreshToken });
    const gmail = google.gmail({ version: "v1", auth: client });
    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: buildRawGmailMessage(input),
        ...(input.threadId === null ? {} : { threadId: input.threadId })
      }
    });
    const providerMessageId = response.data.id;
    const threadId = response.data.threadId;
    if (providerMessageId === null || providerMessageId === undefined || threadId == null) {
      throw new Error("Gmail send response did not contain message and thread identifiers.");
    }
    return { providerMessageId, threadId };
  }
}

interface GmailPayloadBody {
  readonly data?: string | null;
}

interface GmailPayloadPart {
  readonly mimeType?: string | null;
  readonly body?: GmailPayloadBody | null;
  readonly parts?: readonly GmailPayloadPart[] | null;
}

interface GmailHeader {
  readonly name?: string | null;
  readonly value?: string | null;
}

export interface GmailApiMessage {
  readonly id?: string | null;
  readonly threadId?: string | null;
  readonly internalDate?: string | null;
  readonly payload?:
    (GmailPayloadPart & { readonly headers?: readonly GmailHeader[] | null }) | null;
}

function headerMap(headers: readonly GmailHeader[] | null | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  for (const header of headers ?? []) {
    if (header.name !== undefined && header.name !== null && header.value != null) {
      output[header.name.trim().toLowerCase()] = header.value.trim();
    }
  }
  return output;
}

function emailAddresses(value: string): readonly string[] {
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) ?? [];
  return matches.map((candidate) => candidate.toLowerCase());
}

function decodedBody(data: string | null | undefined): string {
  return data === undefined || data === null ? "" : Buffer.from(data, "base64url").toString("utf8");
}

function findMimeBody(
  part: GmailPayloadPart | null | undefined,
  wantedMimeType: string
): string | null {
  if (part === undefined || part === null) {
    return null;
  }
  if (part.mimeType?.toLowerCase() === wantedMimeType && part.body?.data != null) {
    return decodedBody(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const found = findMimeBody(child, wantedMimeType);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function inertHtmlText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/[^\S\n]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function parseGmailInboundMessage(
  message: GmailApiMessage,
  senderEmail: string
): InboundMessage {
  const providerMessageId = message.id;
  const threadId = message.threadId;
  if (providerMessageId == null || threadId == null) {
    throw new Error("Gmail inbound message is missing provider or thread identity.");
  }
  const headers = headerMap(message.payload?.headers);
  const fromAddress = emailAddresses(headers.from ?? "")[0];
  const expectedTo = senderEmail.trim().toLowerCase();
  const toAddress = emailAddresses(headers.to ?? "").find((candidate) => candidate === expectedTo);
  if (fromAddress === undefined || toAddress === undefined) {
    throw new GmailMessageIgnoredError(
      "Gmail message is not an inbound message addressed to the configured sender."
    );
  }
  const plain = findMimeBody(message.payload, "text/plain");
  const html = plain === null ? findMimeBody(message.payload, "text/html") : null;
  const rootBody = decodedBody(message.payload?.body?.data);
  const bodyText = (plain ?? (html === null ? rootBody : inertHtmlText(html))).slice(0, 50_000);
  const internalDate = Number(message.internalDate);
  const headerDate = Date.parse(headers.date ?? "");
  const receivedAt = Number.isFinite(internalDate)
    ? new Date(internalDate)
    : Number.isFinite(headerDate)
      ? new Date(headerDate)
      : null;
  if (receivedAt === null || !Number.isFinite(receivedAt.getTime())) {
    throw new Error("Gmail inbound message has no valid received timestamp.");
  }
  return inboundMessageSchema.parse({
    providerMessageId,
    threadId,
    fromAddress,
    toAddress,
    subject: headers.subject ?? "",
    bodyText,
    receivedAt: receivedAt.toISOString(),
    headers
  });
}

function isHistoryExpired(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const response = "response" in error ? error.response : undefined;
  return (
    typeof response === "object" &&
    response !== null &&
    "status" in response &&
    response.status === 404
  );
}

export class GoogleGmailInboundGateway implements GmailInboundGateway {
  public constructor(
    private readonly configuration: GmailOAuthConfiguration,
    private readonly refreshToken: string
  ) {}

  private gmail() {
    const client = oauthClient(this.configuration);
    client.setCredentials({ refresh_token: this.refreshToken });
    return google.gmail({ version: "v1", auth: client });
  }

  public async currentHistoryId(): Promise<string> {
    const response = await this.gmail().users.getProfile({ userId: "me" });
    if (response.data.historyId == null) {
      throw new Error("Gmail profile did not return a history ID.");
    }
    return response.data.historyId;
  }

  public async listMessagesSince(historyId: string): Promise<GmailHistoryResult> {
    const messages = new Map<string, GmailMessageReference>();
    let pageToken: string | undefined;
    let latestHistoryId = historyId;
    try {
      do {
        const response = await this.gmail().users.history.list({
          userId: "me",
          startHistoryId: historyId,
          historyTypes: ["messageAdded"],
          labelId: "INBOX",
          ...(pageToken === undefined ? {} : { pageToken })
        });
        latestHistoryId = response.data.historyId ?? latestHistoryId;
        for (const history of response.data.history ?? []) {
          for (const added of history.messagesAdded ?? []) {
            const id = added.message?.id;
            const threadId = added.message?.threadId;
            if (id != null && threadId != null) {
              messages.set(id, { providerMessageId: id, threadId });
            }
          }
        }
        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken !== undefined);
    } catch (error) {
      if (isHistoryExpired(error)) {
        throw new GmailHistoryExpiredError();
      }
      throw error;
    }
    return { historyId: latestHistoryId, messages: [...messages.values()] };
  }

  public async listThreadMessages(threadId: string): Promise<readonly GmailMessageReference[]> {
    const response = await this.gmail().users.threads.get({
      userId: "me",
      id: threadId,
      format: "minimal"
    });
    return (response.data.messages ?? []).flatMap((message) =>
      message.id == null || message.threadId == null
        ? []
        : [{ providerMessageId: message.id, threadId: message.threadId }]
    );
  }

  public async getInboundMessage(providerMessageId: string): Promise<InboundMessage> {
    const response = await this.gmail().users.messages.get({
      userId: "me",
      id: providerMessageId,
      format: "full"
    });
    return parseGmailInboundMessage(response.data, this.configuration.senderEmail);
  }
}
