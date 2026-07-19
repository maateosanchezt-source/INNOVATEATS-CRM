"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ChecklistItem {
  readonly key: string;
  readonly category: string;
  readonly label: string;
  readonly status: "unknown" | "passed" | "blocked";
}

export function ReadinessControls({ checklist }: { readonly checklist: readonly ChecklistItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function runEvals() {
    setBusy("evals");
    setNotice(null);
    try {
      const response = await fetch("/api/readiness/evals", { method: "POST" });
      const payload = (await response.json()) as {
        data?: { report?: { automatedPassed?: boolean; pilotReady?: boolean } };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Evaluation failed.");
      }
      setNotice(
        payload.data?.report?.automatedPassed === true
          ? "Automated suite passed. Real pilot evidence is still required."
          : "Automated suite failed. Production remains locked."
      );
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Evaluation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function review(item: ChecklistItem, status: "unknown" | "passed" | "blocked") {
    const confirmation = window.prompt(
      status === "unknown"
        ? `Type ${item.key} to reset this item.`
        : `Describe the evidence for "${item.label}". Type CANCEL to abort.`
    );
    if (
      confirmation === null ||
      confirmation.trim() === "" ||
      confirmation.trim().toUpperCase() === "CANCEL"
    ) {
      return;
    }
    if (status === "unknown" && confirmation.trim() !== item.key) {
      setNotice(`Reset confirmation must exactly match ${item.key}.`);
      return;
    }
    setBusy(item.key);
    setNotice(null);
    try {
      const response = await fetch("/api/readiness/checklist", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: item.key,
          status,
          evidence:
            status === "unknown" ? {} : { note: confirmation.trim(), reviewedIn: "readiness-ui" }
        })
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Checklist update failed.");
      }
      setNotice(`${item.key} is now ${status}. This does not unlock production.`);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Checklist update failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="foundationPanel readinessAction">
        <div>
          <p className="eyebrow">DETERMINISTIC ACCEPTANCE</p>
          <h2>Run the 100-lead suite</h2>
          <p>
            Executes graders and golden cases without providers, sends, or external side effects.
          </p>
        </div>
        <button
          className="primaryButton"
          disabled={busy !== null}
          onClick={() => void runEvals()}
          type="button"
        >
          {busy === "evals" ? "Running..." : "Run evaluation"}
        </button>
      </section>
      {notice !== null && <p className="decisionRecord">{notice}</p>}
      <section className="checklistGrid" aria-label="Go-live checklist">
        {checklist.map((item) => (
          <article className="summaryCard" key={item.key}>
            <p className="eyebrow">{item.category}</p>
            <h3>{item.label}</h3>
            <span className={`modePill checklist-${item.status}`}>{item.status}</span>
            <div className="checklistActions">
              <button
                className="secondaryButton"
                disabled={busy !== null}
                onClick={() => void review(item, "blocked")}
                type="button"
              >
                Block
              </button>
              <button
                className="secondaryButton"
                disabled={busy !== null}
                onClick={() => void review(item, "passed")}
                type="button"
              >
                Pass with evidence
              </button>
              <button
                className="textButton"
                disabled={busy !== null}
                onClick={() => void review(item, "unknown")}
                type="button"
              >
                Reset
              </button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
