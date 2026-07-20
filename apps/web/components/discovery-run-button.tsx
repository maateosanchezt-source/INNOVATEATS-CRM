"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DiscoveryRunButton({
  campaignId,
  disabled
}: {
  readonly campaignId: string;
  readonly disabled: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function queue(): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/discovery/campaigns/${campaignId}/runs`, {
        method: "POST"
      });
      const result = (await response.json()) as {
        readonly error?: { readonly message?: string };
      };
      setMessage(
        response.ok
          ? "Run queued. The worker will pick it up shortly."
          : (result.error?.message ?? "The run could not be queued.")
      );
      router.refresh();
    } catch {
      setMessage("The discovery service could not be reached.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="inlineAction">
      <button
        className="secondaryButton"
        disabled={disabled || pending}
        onClick={() => void queue()}
        type="button"
      >
        {pending ? "Queueing…" : "Run sample"}
      </button>
      {message !== null && <span className="cellSubtext">{message}</span>}
    </div>
  );
}
