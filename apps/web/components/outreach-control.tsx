"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import type { GmailDeliveryMode } from "@innovateats/shared";

interface OutreachControlProps {
  readonly leadId: string;
  readonly enabled: boolean;
  readonly mode: GmailDeliveryMode;
  readonly contacts: readonly {
    readonly id: string;
    readonly label: string;
    readonly actionable: boolean;
  }[];
  readonly campaigns: readonly {
    readonly id: string;
    readonly name: string;
    readonly active: boolean;
    readonly dailyCap: number;
  }[];
  readonly senders: readonly {
    readonly id: string;
    readonly email: string;
    readonly active: boolean;
    readonly connected: boolean;
  }[];
  readonly sequences: readonly {
    readonly id: string;
    readonly status: string;
    readonly deliveryMode: GmailDeliveryMode;
    readonly recipientTimezone: string;
    readonly stopReason: string | null;
    readonly outbounds: readonly {
      readonly id: string;
      readonly sequenceStep: number;
      readonly scheduledAt: string;
      readonly sentAt: string | null;
      readonly deliveryStatus: string;
      readonly error: string | null;
    }[];
  }[];
}

async function responseError(response: Response): Promise<string> {
  const payload = (await response.json()) as {
    error?: { message?: string };
  };
  return payload.error?.message ?? "The operation could not be completed.";
}

export function OutreachControl(props: OutreachControlProps) {
  const router = useRouter();
  const activeCampaigns = useMemo(
    () => props.campaigns.filter((campaign) => campaign.active),
    [props.campaigns]
  );
  const actionableContacts = useMemo(
    () => props.contacts.filter((contact) => contact.actionable),
    [props.contacts]
  );
  const [contactId, setContactId] = useState(actionableContacts[0]?.id ?? "");
  const [campaignId, setCampaignId] = useState(activeCampaigns[0]?.id ?? "");
  const [senderId, setSenderId] = useState(props.senders[0]?.id ?? "");
  const [timezone, setTimezone] = useState("Europe/Madrid");
  const [requestedLanguage, setRequestedLanguage] = useState<"en" | "es">("en");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/${props.leadId}/outreach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactId,
          campaignId,
          senderId,
          timezone,
          requestedLanguage
        })
      });
      const payload = (await response.json()) as {
        data?: {
          compliance?: {
            result?: { decision?: string; reasons?: readonly string[]; effectiveLanguage?: string };
          };
        };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Scheduling failed.");
      }
      const policy = payload.data?.compliance?.result;
      setNotice(
        `${props.mode === "dry_run" ? "Dry-run sequence scheduled; no email can leave the system." : "Sequence scheduled under the active external-delivery gates."} Policy: ${policy?.decision ?? "recorded"} · language ${policy?.effectiveLanguage ?? requestedLanguage}.`
      );
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Scheduling failed.");
    } finally {
      setBusy(false);
    }
  }

  async function connectGmail() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/gmail/oauth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: props.leadId })
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      const payload = (await response.json()) as {
        data: { authorizationUrl: string };
      };
      window.location.assign(payload.data.authorizationUrl);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Gmail connection failed.");
      setBusy(false);
    }
  }

  async function action(sequenceId: string, value: "pause" | "resume" | "cancel") {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/${props.leadId}/outreach/${sequenceId}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: value })
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sequence action failed.");
    } finally {
      setBusy(false);
    }
  }

  const external = props.mode !== "dry_run";
  const selectedSender = props.senders.find((sender) => sender.id === senderId);
  const canSchedule =
    props.enabled &&
    contactId !== "" &&
    campaignId !== "" &&
    senderId !== "" &&
    (!external || selectedSender?.connected === true);

  return (
    <section className="outreachSection">
      <div className="sectionHeading">
        <div>
          <p className="eyebrow">DURABLE OUTREACH</p>
          <h2>Three touches, one immutable approval chain.</h2>
        </div>
        <span className={`modePill ${props.mode}`}>{props.mode.replace("_", " ")}</span>
      </div>
      <div className="outreachGrid">
        <article className="controlCard">
          <h3>Schedule</h3>
          <p className="mutedText">
            Tuesdayâ€“Thursday, 09:00â€“11:30 in the recipient timezone. Touches run on days 1, 4
            and 10; every send is revalidated immediately before dispatch.
          </p>
          <form className="outreachForm" onSubmit={schedule}>
            <label>
              Approved contact
              <select value={contactId} onChange={(event) => setContactId(event.target.value)}>
                <option value="">Select</option>
                {actionableContacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Campaign
              <select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
                <option value="">Select</option>
                {activeCampaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name} Â· cap {campaign.dailyCap}/24h
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sender
              <select value={senderId} onChange={(event) => setSenderId(event.target.value)}>
                <option value="">Select</option>
                {props.senders.map((sender) => (
                  <option key={sender.id} value={sender.id}>
                    {sender.email} Â· {sender.connected ? "connected" : "not connected"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Recipient timezone
              <input
                required
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </label>
            <label>
              Draft language
              <select
                value={requestedLanguage}
                onChange={(event) => setRequestedLanguage(event.target.value as "en" | "es")}
              >
                <option value="en">English</option>
                <option value="es">Spanish (requires reviewed proficiency)</option>
              </select>
            </label>
            <p className="safetyNote">
              Recipient local time now:{" "}
              {(() => {
                try {
                  return new Intl.DateTimeFormat("en-GB", {
                    weekday: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: timezone
                  }).format(new Date());
                } catch {
                  return "invalid timezone";
                }
              })()}{" "}
              · sends are constrained to Tue–Thu 09:00–11:30 local.
            </p>
            <button className="primaryButton" disabled={!canSchedule || busy} type="submit">
              {busy ? "Workingâ€¦" : `Schedule ${props.mode.replace("_", " ")}`}
            </button>
          </form>
          {external && selectedSender?.connected !== true && (
            <button
              className="secondaryButton connectButton"
              disabled={busy}
              onClick={() => void connectGmail()}
              type="button"
            >
              Connect Gmail as Mateo
            </button>
          )}
          <p className="safetyNote">
            Production remains closed until all environment and database gates, plus explicit
            go-live approval, are simultaneously open.
          </p>
          {notice !== null && <p className="decisionRecord">{notice}</p>}
        </article>

        <article className="summaryCard">
          <h3>Sequence ledger</h3>
          {props.sequences.length === 0 ? (
            <p className="mutedText">No sequence has been scheduled for this lead.</p>
          ) : (
            <div className="sequenceList">
              {props.sequences.map((sequence) => (
                <article className="sequenceCard" key={sequence.id}>
                  <div>
                    <strong>{sequence.status.replaceAll("_", " ")}</strong>
                    <small>
                      {sequence.deliveryMode} Â· {sequence.recipientTimezone}
                    </small>
                  </div>
                  <ol>
                    {sequence.outbounds.map((outbound) => (
                      <li key={outbound.id}>
                        Touch {outbound.sequenceStep} Â·{" "}
                        {new Intl.DateTimeFormat("en-GB", {
                          dateStyle: "medium",
                          timeStyle: "short"
                        }).format(new Date(outbound.scheduledAt))}{" "}
                        Â· {outbound.deliveryStatus.replaceAll("_", " ")}
                      </li>
                    ))}
                  </ol>
                  {sequence.stopReason !== null && <p>Stopped: {sequence.stopReason}</p>}
                  {["scheduled", "active", "paused"].includes(sequence.status) && (
                    <div className="sequenceActions">
                      {sequence.status === "paused" ? (
                        <button
                          disabled={busy}
                          onClick={() => void action(sequence.id, "resume")}
                          type="button"
                        >
                          Resume
                        </button>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => void action(sequence.id, "pause")}
                          type="button"
                        >
                          Pause
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => void action(sequence.id, "cancel")}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
