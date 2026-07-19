"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

interface SocialContact {
  readonly id: string;
  readonly label: string;
  readonly channelType: string;
  readonly directUrl: string;
}

interface SocialItemView {
  readonly id: string;
  readonly channel: string;
  readonly directUrl: string;
  readonly message: string;
  readonly status: "draft" | "copied" | "marked_sent" | "cancelled";
  readonly reminderAt: string | null;
  readonly copiedAt: string | null;
  readonly markedSentAt: string | null;
}

async function errorMessage(response: Response): Promise<string> {
  const payload = (await response.json()) as { error?: { message?: string } };
  return payload.error?.message ?? "Manual queue operation failed.";
}

export function SocialManualQueue({
  campaigns,
  contacts,
  enabled,
  items,
  leadId
}: {
  readonly campaigns: readonly {
    readonly id: string;
    readonly name: string;
    readonly active: boolean;
  }[];
  readonly contacts: readonly SocialContact[];
  readonly enabled: boolean;
  readonly items: readonly SocialItemView[];
  readonly leadId: string;
}) {
  const router = useRouter();
  const eligibleContacts = useMemo(
    () =>
      contacts.filter((contact) =>
        ["linkedin", "instagram", "platform_application"].includes(contact.channelType)
      ),
    [contacts]
  );
  const activeCampaigns = campaigns.filter((campaign) => campaign.active);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      const reminder = String(form.get("reminderAt") ?? "");
      const response = await fetch(`/api/leads/${leadId}/social`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactId: form.get("contactId"),
          campaignId: form.get("campaignId"),
          channel: form.get("channel"),
          requestedLanguage: "en",
          ...(reminder === "" ? {} : { reminderAt: new Date(reminder).toISOString() })
        })
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }
      setNotice("Manual-only draft created. Nothing was posted or sent.");
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Manual draft creation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function transition(item: SocialItemView, action: "copied" | "marked_sent" | "cancelled") {
    setBusy(item.id);
    setNotice(null);
    try {
      if (action === "copied") {
        await navigator.clipboard.writeText(item.message);
      }
      const response = await fetch(`/api/leads/${leadId}/social/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }
      setNotice(
        action === "copied"
          ? "Copied locally. Open the direct URL and decide manually whether to send."
          : `Item ${action.replace("_", " ")} by Mateo.`
      );
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Manual queue transition failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="outreachSection">
      <div className="sectionHeading">
        <div>
          <p className="eyebrow">SOCIAL · MANUAL ONLY</p>
          <h2>Draft, copy, open the public URL, decide.</h2>
        </div>
        <span className="modePill dry_run">zero browser automation</span>
      </div>
      <div className="outreachGrid">
        <article className="controlCard">
          <form className="outreachForm" onSubmit={create}>
            <label>
              Public contact path
              <select disabled={!enabled} name="contactId" required>
                <option value="">Select</option>
                {eligibleContacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Platform
              <select disabled={!enabled} name="channel" required>
                <option value="linkedin">LinkedIn</option>
                <option value="instagram">Instagram</option>
                <option value="kickstarter">Kickstarter</option>
                <option value="indiegogo">Indiegogo</option>
                <option value="upwork">Upwork</option>
              </select>
            </label>
            <label>
              Campaign
              <select disabled={!enabled} name="campaignId" required>
                {activeCampaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Follow-up reminder
              <input disabled={!enabled} name="reminderAt" type="datetime-local" />
            </label>
            <button
              className="primaryButton"
              disabled={
                !enabled ||
                busy !== null ||
                eligibleContacts.length === 0 ||
                activeCampaigns.length === 0
              }
              type="submit"
            >
              {busy === "create" ? "Creating…" : "Create manual draft"}
            </button>
          </form>
          {!enabled && (
            <p className="gateNotice">
              Both social-manual feature gates must be enabled. This never enables platform
              automation.
            </p>
          )}
          {notice !== null && <p className="decisionRecord">{notice}</p>}
        </article>
        <article className="summaryCard">
          <h3>Manual ledger</h3>
          {items.length === 0 ? (
            <p className="mutedText">No manual platform draft exists for this lead.</p>
          ) : (
            <div className="sequenceList">
              {items.map((item) => (
                <article className="sequenceCard" key={item.id}>
                  <div>
                    <strong>{item.channel}</strong>
                    <small>{item.status.replace("_", " ")}</small>
                  </div>
                  <p className="replyPreview">{item.message}</p>
                  {item.reminderAt !== null && (
                    <small>Reminder: {new Date(item.reminderAt).toLocaleString()}</small>
                  )}
                  <div className="sequenceActions">
                    <a href={item.directUrl} rel="noreferrer" target="_blank">
                      Open direct URL
                    </a>
                    {item.status === "draft" && (
                      <button
                        disabled={busy !== null}
                        onClick={() => void transition(item, "copied")}
                        type="button"
                      >
                        Copy draft
                      </button>
                    )}
                    {item.status === "copied" && (
                      <button
                        disabled={busy !== null}
                        onClick={() => void transition(item, "marked_sent")}
                        type="button"
                      >
                        I sent it manually
                      </button>
                    )}
                    {(item.status === "draft" || item.status === "copied") && (
                      <button
                        disabled={busy !== null}
                        onClick={() => void transition(item, "cancelled")}
                        type="button"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
