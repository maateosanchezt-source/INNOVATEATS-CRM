import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildRawGmailMessage,
  decryptGmailRefreshToken,
  encryptGmailRefreshToken,
  outboundInternetMessageId,
  renderOutboundBody
} from "../../src/gmail.js";

function decodeRaw(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

describe("Gmail integration", () => {
  it("encrypts refresh tokens with authenticated encryption", () => {
    const key = randomBytes(32).toString("base64");
    const encrypted = encryptGmailRefreshToken("refresh-token-secret", key);

    expect(encrypted).not.toContain("refresh-token-secret");
    expect(decryptGmailRefreshToken(encrypted, key)).toBe("refresh-token-secret");
    expect(() => decryptGmailRefreshToken(encrypted, randomBytes(32).toString("base64"))).toThrow(
      /could not be decrypted/u
    );
  });

  it("builds a plain-text threaded MIME message", () => {
    const internetMessageId = outboundInternetMessageId("campaign:lead:2:email");
    const raw = buildRawGmailMessage({
      to: "recipient@example.com",
      from: "maateosanchezt@gmail.com",
      subject: "A useful thought",
      body: "Hello from InnovatEats.",
      internetMessageId,
      threadId: "gmail-thread",
      inReplyTo: "<original@example.com>",
      references: ["<original@example.com>"]
    });
    const mime = decodeRaw(raw);

    expect(mime).toContain(`Message-ID: ${internetMessageId}`);
    expect(mime).toContain("In-Reply-To: <original@example.com>");
    expect(mime).toContain("References: <original@example.com>");
    expect(mime).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(mime).not.toContain("Hello from InnovatEats.");
  });

  it("adds identity, website, and easy opt-out to the approved body", () => {
    const rendered = renderOutboundBody("Approved copy.\n\nInnovatEats: https://innovateats.com");

    expect(rendered).toContain("Mateo Sanchez / InnovatEats");
    expect(rendered).toContain('reply "no"');
    expect(rendered.match(/https:\/\/innovateats\.com/gu)).toHaveLength(2);
  });

  it("blocks header injection", () => {
    expect(() =>
      buildRawGmailMessage({
        to: "recipient@example.com",
        from: "maateosanchezt@gmail.com",
        subject: "Safe\r\nBcc: victim@example.com",
        body: "Body",
        internetMessageId: "<safe@example.com>",
        threadId: null,
        inReplyTo: null,
        references: []
      })
    ).toThrow(/forbidden line break/u);
  });
});
