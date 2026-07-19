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

export const gmailSendScope = "https://www.googleapis.com/auth/gmail.send";
export const gmailIdentityScopes = ["openid", "email", gmailSendScope] as const;

export interface GmailOAuthConfiguration {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly senderEmail: string;
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
    return oauthClient(this.configuration).generateAuthUrl({
      access_type: "offline",
      include_granted_scopes: true,
      prompt: "consent",
      scope: [...gmailIdentityScopes],
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
    return {
      senderEmail: email,
      refreshToken,
      scopes: [...gmailIdentityScopes]
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

export function renderOutboundBody(approvedBody: string): string {
  if (!approvedBody.includes(INNOVATEATS_WEBSITE)) {
    throw new Error(`Approved body must contain ${INNOVATEATS_WEBSITE}.`);
  }
  return `${approvedBody.trim()}\n\nMateo Sanchez / InnovatEats\n${INNOVATEATS_WEBSITE}\nIf this is not relevant, reply "no" and I will not contact you again.`;
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
