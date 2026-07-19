"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import type {
  MateoCredentialKey,
  MessageBrief,
  MessageDraftContent,
  MessageEvidenceMapItem,
  MessageQaReview
} from "@innovateats/shared";

interface ContactOption {
  readonly id: string;
  readonly label: string;
  readonly actionable: boolean;
}

interface EvidenceOption {
  readonly id: string;
  readonly claim: string;
  readonly sourceUrl: string;
}

interface ApprovalView {
  readonly decision: "approved" | "rejected";
  readonly reason: string | null;
  readonly actorId: string;
  readonly createdAt: string;
}

interface DraftView extends MessageDraftContent {
  readonly id: string;
  readonly version: number;
  readonly supersedesId: string | null;
  readonly editSource: "agent" | "human";
  readonly qa: MessageQaReview;
  readonly approval: ApprovalView | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

interface WorkspaceView {
  readonly brief: {
    readonly diagnosis: string;
    readonly opportunity: string;
    readonly mateoFit: string;
    readonly brief: MessageBrief;
  } | null;
  readonly drafts: readonly DraftView[];
}

const credentialsByOpportunity = {
  product: [
    ["chef_rd", "Chef + food R&D"],
    ["integrated_operator", "Product + positioning + ecommerce"]
  ],
  ecommerce: [
    ["ecommerce_operator", "Ecommerce operator"],
    ["paid_media_200k", "EUR 200k own paid acquisition"],
    ["integrated_operator", "Product + positioning + ecommerce"]
  ],
  integrated: [
    ["integrated_operator", "Product + positioning + ecommerce"],
    ["chef_rd", "Chef + food R&D"],
    ["ecommerce_operator", "Ecommerce operator"]
  ],
  cultural: [["chef_rd", "Culinary background"]],
  paid_launch: [
    ["paid_media_200k", "EUR 200k own paid acquisition"],
    ["ecommerce_operator", "Ecommerce operator"]
  ]
} as const satisfies Readonly<Record<string, readonly (readonly [MateoCredentialKey, string])[]>>;

function stepLabel(step: number): string {
  if (step === 1) {
    return "Initial email";
  }
  return step === 2 ? "Follow-up · day 4" : "Close loop · day 10";
}

function latestByStep(drafts: readonly DraftView[]): readonly DraftView[] {
  return [1, 2, 3].flatMap((step) => {
    const versions = drafts.filter((draft) => draft.sequenceStep === step);
    const latest = versions.at(-1);
    return latest === undefined ? [] : [latest];
  });
}

function PreviousVersionDiff({
  current,
  previous
}: {
  readonly current: DraftView;
  readonly previous: DraftView | undefined;
}) {
  if (previous === undefined) {
    return null;
  }
  return (
    <details className="messageDiff">
      <summary>
        Human edit diff · v{previous.version} → v{current.version}
      </summary>
      <div className="diffGrid">
        <div>
          <strong>Before</strong>
          {previous.subject !== null && <del>{previous.subject}</del>}
          <del>{previous.body}</del>
        </div>
        <div>
          <strong>After</strong>
          {current.subject !== null && <ins>{current.subject}</ins>}
          <ins>{current.body}</ins>
        </div>
      </div>
    </details>
  );
}

export function MessageApprovalWorkspace({
  contacts,
  defaultBrand,
  defaultDiscoveryFact,
  defaultProduct,
  enabled,
  evidence,
  leadId,
  workspace
}: {
  readonly contacts: readonly ContactOption[];
  readonly defaultBrand: string;
  readonly defaultDiscoveryFact: string;
  readonly defaultProduct: string;
  readonly enabled: boolean;
  readonly evidence: readonly EvidenceOption[];
  readonly leadId: string;
  readonly workspace: WorkspaceView;
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [opportunityType, setOpportunityType] =
    useState<keyof typeof credentialsByOpportunity>("integrated");
  const actionableContacts = contacts.filter((contact) => contact.actionable);
  const currentDrafts = useMemo(() => latestByStep(workspace.drafts), [workspace.drafts]);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyKey("generate");
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/leads/${leadId}/messages/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactId: form.get("contactId"),
          language: form.get("language"),
          contactFirstName: String(form.get("contactFirstName") ?? "").trim() || null,
          brandName: form.get("brandName"),
          productDescription: form.get("productDescription"),
          discoveryFact: form.get("discoveryFact"),
          specificOpportunity: form.get("specificOpportunity"),
          nextExecutionStep: form.get("nextExecutionStep"),
          opportunityType: form.get("opportunityType"),
          selectedCredentials: [form.get("selectedCredential")],
          evidenceIds: form.getAll("evidenceIds")
        })
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Message generation failed.");
      }
      setMessage("Three-touch sequence generated, QA-passed, and queued for your approval.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Message generation failed.");
    } finally {
      setBusyKey(null);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, draft: DraftView) {
    event.preventDefault();
    setBusyKey(`edit-${draft.id}`);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/leads/${leadId}/messages/${draft.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: draft.sequenceStep === 1 ? form.get("subject") : null,
          body: form.get("body")
        })
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Draft edit failed.");
      }
      setMessage(`Step ${draft.sequenceStep} stored as immutable version ${draft.version + 1}.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Draft edit failed.");
    } finally {
      setBusyKey(null);
    }
  }

  async function decide(
    formElement: HTMLFormElement,
    draft: DraftView,
    decision: "approved" | "rejected"
  ) {
    setBusyKey(`${decision}-${draft.id}`);
    setMessage(null);
    const form = new FormData(formElement);
    try {
      const response = await fetch(`/api/leads/${leadId}/messages/${draft.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          reason: String(form.get("reason") ?? "").trim() || null
        })
      });
      const payload = (await response.json()) as {
        data?: { allCurrentDraftsApproved: boolean };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Decision failed.");
      }
      setMessage(
        payload.data?.allCurrentDraftsApproved
          ? "All three current versions are approved. Scheduling remains disabled until Phase 5."
          : `Step ${draft.sequenceStep} ${decision}.`
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Decision failed.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="messageSection">
      <div className="sectionHeading">
        <div>
          <p className="eyebrow">MESSAGE STRATEGY + HUMAN APPROVAL</p>
          <h2>Diagnosis to evidence-backed copy.</h2>
        </div>
        <span className="countPill">
          {currentDrafts.filter((draft) => draft.approval?.decision === "approved").length}/3
          approved
        </span>
      </div>

      {workspace.brief === null ? (
        <form className="messageBriefForm" onSubmit={generate}>
          <label>
            Actionable email
            <select disabled={!enabled || busyKey !== null} name="contactId" required>
              {actionableContacts.length === 0 ? (
                <option value="">Verify a published email first</option>
              ) : (
                actionableContacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.label}
                  </option>
                ))
              )}
            </select>
          </label>
          <label>
            Language
            <select defaultValue="en" disabled={!enabled || busyKey !== null} name="language">
              <option value="en">English</option>
              <option value="es">Spanish</option>
            </select>
          </label>
          <label>
            First name (optional)
            <input disabled={!enabled || busyKey !== null} name="contactFirstName" />
          </label>
          <label>
            Brand
            <input
              defaultValue={defaultBrand}
              disabled={!enabled || busyKey !== null}
              name="brandName"
              readOnly
              required
            />
          </label>
          <label className="wideField">
            Product / format
            <textarea
              defaultValue={defaultProduct}
              disabled={!enabled || busyKey !== null}
              name="productDescription"
              required
              rows={2}
            />
          </label>
          <label className="wideField">
            Discovery fact
            <textarea
              defaultValue={defaultDiscoveryFact}
              disabled={!enabled || busyKey !== null}
              name="discoveryFact"
              required
              rows={2}
            />
          </label>
          <label className="wideField">
            Specific opportunity
            <textarea
              disabled={!enabled || busyKey !== null}
              name="specificOpportunity"
              placeholder="Clarify the hero format before retailer outreach"
              required
              rows={2}
            />
          </label>
          <label>
            Next execution step
            <input
              disabled={!enabled || busyKey !== null}
              name="nextExecutionStep"
              placeholder="the first retailer conversations"
              required
            />
          </label>
          <label>
            Opportunity type
            <select
              disabled={!enabled || busyKey !== null}
              name="opportunityType"
              onChange={(event) =>
                setOpportunityType(
                  event.currentTarget.value as keyof typeof credentialsByOpportunity
                )
              }
              value={opportunityType}
            >
              <option value="product">Product</option>
              <option value="ecommerce">Ecommerce</option>
              <option value="integrated">Integrated</option>
              <option value="cultural">Cultural</option>
              <option value="paid_launch">Paid launch</option>
            </select>
          </label>
          <label>
            Mateo proof
            <select disabled={!enabled || busyKey !== null} name="selectedCredential">
              {credentialsByOpportunity[opportunityType].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="messageEvidencePicker">
            <legend>Evidence used for factual claims</legend>
            {evidence.map((item) => (
              <label key={item.id}>
                <input
                  defaultChecked
                  disabled={!enabled || busyKey !== null}
                  name="evidenceIds"
                  type="checkbox"
                  value={item.id}
                />
                <span>
                  {item.claim}
                  <small>{item.sourceUrl}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <button
            disabled={
              !enabled ||
              actionableContacts.length === 0 ||
              evidence.length === 0 ||
              busyKey !== null
            }
            type="submit"
          >
            {busyKey === "generate" ? "Generating + reviewing…" : "Generate 3-message sequence"}
          </button>
        </form>
      ) : (
        <>
          <div className="strategySummary">
            <article>
              <span>Diagnosis</span>
              <p>{workspace.brief.diagnosis}</p>
            </article>
            <article>
              <span>Opportunity</span>
              <p>{workspace.brief.opportunity}</p>
            </article>
            <article>
              <span>InnovatEats fit</span>
              <p>{workspace.brief.mateoFit.replaceAll("_", " ")}</p>
            </article>
          </div>

          <div className="messageDraftList">
            {currentDrafts.map((draft) => {
              const previous = workspace.drafts.find(
                (candidate) => candidate.id === draft.supersedesId
              );
              return (
                <article className="messageDraftCard" key={draft.id}>
                  <div className="messageDraftTop">
                    <div>
                      <span>{stepLabel(draft.sequenceStep)}</span>
                      <strong>
                        v{draft.version} · {draft.editSource}
                      </strong>
                    </div>
                    <span className={`approvalBadge ${draft.approval?.decision ?? "pending"}`}>
                      {draft.approval?.decision ?? "pending"}
                    </span>
                  </div>
                  <div className="qaStrip">
                    <span>Facts {draft.qa.factualityScore}</span>
                    <span>Specificity {draft.qa.specificityScore}</span>
                    <span>Sales {draft.qa.salesQualityScore}</span>
                    <span>{draft.wordCount} words</span>
                  </div>
                  <form
                    className="messageEditForm"
                    onSubmit={(event) => void saveEdit(event, draft)}
                  >
                    {draft.sequenceStep === 1 && (
                      <label>
                        Subject
                        <input
                          defaultValue={draft.subject ?? ""}
                          disabled={draft.approval?.decision === "approved" || busyKey !== null}
                          name="subject"
                          required
                        />
                      </label>
                    )}
                    <label>
                      Body
                      <textarea
                        defaultValue={draft.body}
                        disabled={draft.approval?.decision === "approved" || busyKey !== null}
                        name="body"
                        required
                        rows={10}
                      />
                    </label>
                    <small>
                      Keep paragraph structure, factual paragraphs, and personalization tokens
                      intact. Inferences and offer language can be edited. Every version must retain
                      https://innovateats.com and pass QA.
                    </small>
                    {draft.approval?.decision !== "approved" && (
                      <button disabled={busyKey !== null} type="submit">
                        Save immutable edit
                      </button>
                    )}
                  </form>
                  <PreviousVersionDiff current={draft} previous={previous} />
                  <details className="evidenceMap">
                    <summary>Evidence map · {draft.evidenceMap.length} spans</summary>
                    <ul>
                      {draft.evidenceMap.map((item: MessageEvidenceMapItem, index) => (
                        <li key={`${item.kind}-${index}`}>
                          <strong>{item.kind}</strong>
                          <span>{item.textSpan}</span>
                          {item.evidenceIds.length > 0 && (
                            <small>{item.evidenceIds.join(", ")}</small>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                  {draft.approval === null ? (
                    <form
                      className="decisionForm"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void decide(event.currentTarget, draft, "approved");
                      }}
                    >
                      <input
                        disabled={busyKey !== null}
                        name="reason"
                        placeholder="Required only when rejecting"
                      />
                      <div>
                        <button
                          className="secondaryButton"
                          disabled={busyKey !== null}
                          onClick={(event) => {
                            event.preventDefault();
                            const form = event.currentTarget.form;
                            if (form !== null) {
                              void decide(form, draft, "rejected");
                            }
                          }}
                          type="button"
                        >
                          Reject
                        </button>
                        <button disabled={busyKey !== null} type="submit">
                          Approve this version
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="decisionRecord">
                      {draft.approval.decision} by {draft.approval.actorId}
                      {draft.approval.reason === null ? "" : ` · ${draft.approval.reason}`}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}

      {!enabled && workspace.brief === null && (
        <p className="gateNotice">
          Message generation is fail-closed. Enable both configuration and database gates to run it.
        </p>
      )}
      {message !== null && <p className="formMessage">{message}</p>}
    </section>
  );
}
