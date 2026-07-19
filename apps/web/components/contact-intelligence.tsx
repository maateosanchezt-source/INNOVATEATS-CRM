"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface ContactView {
  readonly id: string;
  readonly channelType: string;
  readonly value: string;
  readonly directUrl: string;
  readonly sourceUrl: string;
  readonly provenance: string;
  readonly origin: string;
  readonly verificationStatus: string;
  readonly verificationProvider: string | null;
  readonly confidence: number;
  readonly doNotContact: boolean;
}

interface EvidenceOption {
  readonly id: string;
  readonly sourceUrl: string;
}

function readable(value: string): string {
  return value.replaceAll("_", " ");
}

export function ContactIntelligence({
  contacts,
  enabled,
  evidenceOptions,
  leadId
}: {
  readonly contacts: readonly ContactView[];
  readonly enabled: boolean;
  readonly evidenceOptions: readonly EvidenceOption[];
  readonly leadId: string;
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function extract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyKey("extract");
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/leads/${leadId}/contacts/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidenceId: form.get("evidenceId") })
      });
      const payload = (await response.json()) as {
        data?: { createdCount: number; warnings: string[] };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Contact extraction failed.");
      }
      const warnings = payload.data?.warnings ?? [];
      setMessage(
        `${payload.data?.createdCount ?? 0} contact path(s) added.${
          warnings.length > 0 ? ` ${warnings.join(" ")}` : ""
        }`
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Contact extraction failed.");
    } finally {
      setBusyKey(null);
    }
  }

  async function verify(contactId: string) {
    setBusyKey(contactId);
    setMessage(null);
    try {
      const response = await fetch(`/api/leads/${leadId}/contacts/${contactId}/verify`, {
        method: "POST"
      });
      const payload = (await response.json()) as {
        data?: { verification: { status: string; reason: string } };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Email verification failed.");
      }
      setMessage(
        `${readable(payload.data?.verification.status ?? "unknown")}: ${
          payload.data?.verification.reason ?? "Verification recorded."
        }`
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Email verification failed.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="contactSection">
      <div className="sectionHeading">
        <div>
          <p className="eyebrow">CONTACT INTELLIGENCE</p>
          <h2>Public paths, exact provenance.</h2>
        </div>
        <span className="countPill">{contacts.length}</span>
      </div>

      <form className="contactExtractForm" onSubmit={extract}>
        <label>
          Official source snapshot
          <select
            disabled={!enabled || evidenceOptions.length === 0 || busyKey !== null}
            name="evidenceId"
            required
          >
            {evidenceOptions.length === 0 ? (
              <option value="">Capture an official snapshot first</option>
            ) : (
              evidenceOptions.map((evidence) => (
                <option key={evidence.id} value={evidence.id}>
                  {evidence.sourceUrl}
                </option>
              ))
            )}
          </select>
        </label>
        <button
          disabled={!enabled || evidenceOptions.length === 0 || busyKey !== null}
          type="submit"
        >
          {busyKey === "extract" ? "Extracting…" : "Extract public contacts"}
        </button>
      </form>
      {!enabled && (
        <p className="gateNotice">
          Contact enrichment is fail-closed. Enable both configuration and database gates to run it.
        </p>
      )}
      {message !== null && <p className="formMessage">{message}</p>}

      {contacts.length === 0 ? (
        <p className="emptyState">No contact path has been stored for this organization.</p>
      ) : (
        <div className="contactGrid">
          {contacts.map((contact) => {
            const email =
              contact.channelType === "corporate_email" ||
              contact.channelType === "named_business_email";
            return (
              <article className="contactCard" key={contact.id}>
                <div className="contactCardTop">
                  <span className="contactChannel">{readable(contact.channelType)}</span>
                  <span className={`verificationBadge ${contact.verificationStatus}`}>
                    {readable(contact.verificationStatus)}
                  </span>
                </div>
                <a href={contact.directUrl} rel="noreferrer" target="_blank">
                  {contact.value}
                </a>
                <p>{contact.provenance}</p>
                <small>
                  {Math.round(contact.confidence * 100)}% confidence · {readable(contact.origin)}
                  {contact.verificationProvider === null
                    ? ""
                    : ` · ${contact.verificationProvider}`}
                </small>
                <div className="contactActions">
                  <a href={contact.sourceUrl} rel="noreferrer" target="_blank">
                    Source
                  </a>
                  {email && (
                    <button
                      disabled={!enabled || contact.doNotContact || busyKey !== null}
                      onClick={() => void verify(contact.id)}
                      type="button"
                    >
                      {busyKey === contact.id ? "Checking…" : "Check MX / provider"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
