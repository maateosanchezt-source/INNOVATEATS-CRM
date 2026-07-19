"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { leadStages } from "@innovateats/shared";

interface ApiResult {
  readonly data?: { readonly leadId: string; readonly created: boolean };
  readonly error?: { readonly message?: string };
}

export function ManualLeadForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: form.get("sourceUrl"),
          brandName: form.get("brandName"),
          productSummary: form.get("productSummary"),
          country: form.get("country"),
          regionCode: form.get("regionCode"),
          stage: form.get("stage"),
          discoverySignal: form.get("discoverySignal"),
          preliminaryScore: form.get("preliminaryScore")
        })
      });
      const result = (await response.json()) as ApiResult;

      if (!response.ok || result.data === undefined) {
        setMessage(result.error?.message ?? "The lead could not be created.");
        return;
      }

      router.push(`/leads/${result.data.leadId}`);
      router.refresh();
    } catch {
      setMessage("The CRM could not be reached. Your form has not been cleared.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="ingestForm" onSubmit={(event) => void submit(event)}>
      <div className="formHeading">
        <div>
          <p className="eyebrow">MANUAL INGEST</p>
          <h2>Add a public lead URL</h2>
        </div>
        <span className="safePill">No agent runs</span>
      </div>
      <div className="formGrid">
        <label>
          Public URL
          <input name="sourceUrl" placeholder="https://brand.com/launch" required type="url" />
        </label>
        <label>
          Brand
          <input name="brandName" placeholder="Brand name" required />
        </label>
        <label className="wideField">
          Product summary
          <input name="productSummary" placeholder="One hero product or narrow category" />
        </label>
        <label>
          Country
          <input defaultValue="Unknown" name="country" required />
        </label>
        <label>
          Region
          <select defaultValue="" name="regionCode">
            <option value="">Unassigned</option>
            <option value="US">US</option>
            <option value="UK">UK</option>
            <option value="ES">Spain</option>
            <option value="CENTRAL_EU">Central Europe</option>
            <option value="AU_NZ">Australia / New Zealand</option>
            <option value="ASIA">Asia</option>
          </select>
        </label>
        <label>
          Stage
          <select defaultValue="unknown" name="stage">
            {leadStages.map((stage) => (
              <option key={stage} value={stage}>
                {stage.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Preliminary score
          <input defaultValue="0" max="100" min="0" name="preliminaryScore" type="number" />
        </label>
        <label className="wideField">
          Discovery signal
          <textarea
            name="discoverySignal"
            placeholder="Why is this lead worth researching?"
            rows={3}
          />
        </label>
      </div>
      <div className="formFooter">
        <button className="primaryButton" disabled={pending} type="submit">
          {pending ? "Saving…" : "Create lead"}
        </button>
        {message !== null && (
          <p className="errorText" role="alert">
            {message}
          </p>
        )}
      </div>
    </form>
  );
}
