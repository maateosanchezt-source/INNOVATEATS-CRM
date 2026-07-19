"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

interface ResearchResponse {
  readonly error?: { readonly message?: string };
}

export function ResearchCaptureForm({
  leadId,
  defaultUrl,
  enabled
}: {
  readonly leadId: string;
  readonly defaultUrl: string;
  readonly enabled: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(`/api/leads/${leadId}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: form.get("sourceUrl") })
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as ResearchResponse;
        setMessage(result.error?.message ?? "Research capture failed.");
        return;
      }
      setMessage("Snapshot captured with provenance.");
      router.refresh();
    } catch {
      setMessage("The CRM could not be reached. No research action was recorded.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="researchCaptureForm" onSubmit={(event) => void submit(event)}>
      <label>
        Public research URL
        <input defaultValue={defaultUrl} disabled={!enabled} name="sourceUrl" required type="url" />
      </label>
      <button className="secondaryButton" disabled={!enabled || pending} type="submit">
        {pending ? "Capturing…" : "Capture safely"}
      </button>
      {!enabled && (
        <p className="mutedText">
          Research is fail-closed. Enable both the environment and database research flags first.
        </p>
      )}
      {message !== null && (
        <p className="formMessage" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
