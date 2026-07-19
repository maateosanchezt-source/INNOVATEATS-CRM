"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReplyActions({
  replyId,
  suggestedReply,
  owned,
  ownable
}: {
  readonly replyId: string;
  readonly suggestedReply: string;
  readonly owned: boolean;
  readonly ownable: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "copying" | "owning" | "error">("idle");

  async function copyDraft(): Promise<void> {
    setState("copying");
    try {
      await navigator.clipboard.writeText(suggestedReply);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  async function markOwned(): Promise<void> {
    setState("owning");
    try {
      const response = await fetch(`/api/replies/${replyId}/mark-owned`, { method: "POST" });
      if (!response.ok) {
        throw new Error("Handoff could not be marked owned.");
      }
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <div className="replyActions">
      <button className="secondaryButton" disabled={state !== "idle"} onClick={copyDraft}>
        Copy suggested reply
      </button>
      <button disabled={!ownable || owned || state !== "idle"} onClick={markOwned}>
        {owned
          ? "Mateo owns this"
          : !ownable
            ? "No ownership needed"
            : state === "owning"
              ? "Taking ownership…"
              : "Mark Mateo-owned"}
      </button>
      {state === "error" && <span role="alert">Action failed. Nothing was sent.</span>}
    </div>
  );
}
