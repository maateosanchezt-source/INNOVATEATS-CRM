"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DiscoveryCandidateDecision({ candidateId }: { readonly candidateId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(decision: "approved" | "rejected"): Promise<void> {
    if (reason.trim().length < 3) {
      setMessage("Add a short reason first.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/discovery/candidates/${candidateId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason })
      });
      const result = (await response.json()) as {
        readonly error?: { readonly message?: string };
      };
      if (!response.ok) {
        setMessage(result.error?.message ?? "Decision could not be saved.");
        return;
      }
      router.refresh();
    } catch {
      setMessage("The CRM could not be reached.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="candidateDecision">
      <input
        aria-label="Decision reason"
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why yes or no?"
        value={reason}
      />
      <div className="decisionButtons">
        <button disabled={pending} onClick={() => void decide("approved")} type="button">
          Yes
        </button>
        <button disabled={pending} onClick={() => void decide("rejected")} type="button">
          No
        </button>
      </div>
      {message !== null && <span className="errorText">{message}</span>}
    </div>
  );
}
