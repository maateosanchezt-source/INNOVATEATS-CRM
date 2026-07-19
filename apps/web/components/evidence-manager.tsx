"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export interface EvidenceView {
  readonly id: string;
  readonly factType: string;
  readonly claim: string;
  readonly quoteOrSummary: string;
  readonly sourceUrl: string;
  readonly observedAt: string;
  readonly confidence: number;
  readonly isInference: boolean;
  readonly version: number;
}

function EvidenceForm({
  initial,
  pending,
  onSubmit,
  onCancel
}: {
  readonly initial?: EvidenceView;
  readonly pending: boolean;
  readonly onSubmit: (input: Record<string, unknown>) => Promise<boolean>;
  readonly onCancel?: () => void;
}) {
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const saved = await onSubmit({
      factType: form.get("factType"),
      claim: form.get("claim"),
      quoteOrSummary: form.get("quoteOrSummary"),
      sourceUrl: form.get("sourceUrl"),
      confidence: form.get("confidence"),
      isInference: form.get("isInference") === "on"
    });
    if (saved && initial === undefined) {
      formElement.reset();
    }
  }

  return (
    <form className="evidenceForm" onSubmit={(event) => void submit(event)}>
      <div className="formGrid">
        <label>
          Fact type
          <input defaultValue={initial?.factType} name="factType" required />
        </label>
        <label>
          Confidence
          <input
            defaultValue={initial?.confidence ?? 0.8}
            max="1"
            min="0"
            name="confidence"
            required
            step="0.05"
            type="number"
          />
        </label>
        <label className="wideField">
          Claim
          <input defaultValue={initial?.claim} name="claim" required />
        </label>
        <label className="wideField">
          Quote or summary
          <textarea
            defaultValue={initial?.quoteOrSummary}
            name="quoteOrSummary"
            required
            rows={3}
          />
        </label>
        <label className="wideField">
          Source URL
          <input defaultValue={initial?.sourceUrl} name="sourceUrl" required type="url" />
        </label>
        <label className="checkboxLabel">
          <input defaultChecked={initial?.isInference} name="isInference" type="checkbox" />
          Mark as inference
        </label>
      </div>
      <div className="formFooter">
        <button className="secondaryButton" disabled={pending} type="submit">
          {pending ? "Saving…" : initial === undefined ? "Add evidence" : "Save new version"}
        </button>
        {onCancel !== undefined && (
          <button className="textButton" onClick={onCancel} type="button">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function EvidenceManager({
  leadId,
  records
}: {
  readonly leadId: string;
  readonly records: readonly EvidenceView[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mutate(
    url: string,
    method: "POST" | "PATCH",
    input: Record<string, unknown>
  ): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(result.error?.message ?? "Evidence could not be saved.");
        return false;
      }
      setEditing(null);
      router.refresh();
      return true;
    } catch {
      setError("The CRM could not be reached. Your evidence has not been cleared.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function remove(evidenceId: string): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/leads/${leadId}/evidence/${evidenceId}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        setError("Evidence could not be removed.");
        return;
      }
      router.refresh();
    } catch {
      setError("The CRM could not be reached. Evidence was not removed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="evidenceSection">
      <div className="sectionHeading">
        <div>
          <p className="eyebrow">EVIDENCE</p>
          <h2>Claims with provenance</h2>
        </div>
        <span className="countPill">{records.length} active</span>
      </div>

      <EvidenceForm
        onSubmit={(input) => mutate(`/api/leads/${leadId}/evidence`, "POST", input)}
        pending={pending}
      />
      {error !== null && (
        <p className="errorText" role="alert">
          {error}
        </p>
      )}

      <div className="evidenceList">
        {records.map((record) => (
          <article className="evidenceCard" key={record.id}>
            {editing === record.id ? (
              <EvidenceForm
                initial={record}
                onCancel={() => setEditing(null)}
                onSubmit={(input) =>
                  mutate(`/api/leads/${leadId}/evidence/${record.id}`, "PATCH", input)
                }
                pending={pending}
              />
            ) : (
              <>
                <div className="evidenceMeta">
                  <span>{record.factType}</span>
                  <span>v{record.version}</span>
                  <span>{Math.round(record.confidence * 100)}% confidence</span>
                  {record.isInference && <span className="warningPill">Inference</span>}
                </div>
                <h3>{record.claim}</h3>
                <p>{record.quoteOrSummary}</p>
                <div className="evidenceActions">
                  <a href={record.sourceUrl} rel="noreferrer" target="_blank">
                    Open source
                  </a>
                  <button className="textButton" onClick={() => setEditing(record.id)}>
                    Revise
                  </button>
                  <button
                    className="dangerTextButton"
                    disabled={pending}
                    onClick={() => void remove(record.id)}
                  >
                    Remove
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
