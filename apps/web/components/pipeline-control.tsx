"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { allowedTransitionsFrom, type LeadStatus } from "@innovateats/shared";

export function PipelineControl({
  leadId,
  currentStatus
}: {
  readonly leadId: string;
  readonly currentStatus: LeadStatus;
}) {
  const router = useRouter();
  const transitions = allowedTransitionsFrom(currentStatus);
  const [status, setStatus] = useState<LeadStatus>(transitions[0] ?? currentStatus);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function update(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(result.error?.message ?? "Pipeline update failed.");
        return;
      }

      router.refresh();
    } catch {
      setError("The CRM could not be reached. The lead was not moved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="controlCard">
      <div>
        <p className="eyebrow">PIPELINE</p>
        <h2>{currentStatus.replaceAll("_", " ")}</h2>
      </div>
      {transitions.length === 0 ? (
        <p className="mutedText">This state is terminal. No direct transition is available.</p>
      ) : (
        <div className="stackedControls">
          <label>
            Next state
            <select
              onChange={(event) => setStatus(event.target.value as LeadStatus)}
              value={status}
            >
              {transitions.map((transition) => (
                <option key={transition} value={transition}>
                  {transition.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reason
            <input
              onChange={(event) => setReason(event.target.value)}
              placeholder="Decision context"
              value={reason}
            />
          </label>
          <button className="secondaryButton" disabled={pending} onClick={() => void update()}>
            {pending ? "Updating…" : "Move lead"}
          </button>
          {error !== null && <p className="errorText">{error}</p>}
        </div>
      )}
    </section>
  );
}
