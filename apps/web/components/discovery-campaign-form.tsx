"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import type { DiscoverySeedInput, DiscoveryTrack } from "@innovateats/shared";

interface ApiResult {
  readonly data?: { readonly id: string };
  readonly error?: { readonly message?: string };
}

function lines(value: FormDataEntryValue | null): readonly string[] {
  return typeof value === "string"
    ? value
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line !== "")
    : [];
}

function keywordSeeds(
  values: readonly string[],
  track: DiscoveryTrack
): readonly DiscoverySeedInput[] {
  return values.map((value) => ({ kind: "keyword", value, track, priority: 60 }));
}

function audienceSeeds(
  values: readonly string[],
  track: DiscoveryTrack
): readonly DiscoverySeedInput[] {
  return values.map((value) => ({
    kind: "profile_followers",
    value,
    track,
    priority: 80
  }));
}

export function DiscoveryCampaignForm({ enabled }: { readonly enabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const seeds = [
      ...keywordSeeds(lines(form.get("foodKeywords")), "food_brand"),
      ...audienceSeeds(lines(form.get("foodProfiles")), "food_brand"),
      ...keywordSeeds(lines(form.get("dropshipKeywords")), "dropshipping_founder"),
      ...audienceSeeds(lines(form.get("dropshipProfiles")), "dropshipping_founder")
    ];

    try {
      const response = await fetch("/api/discovery/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          regionCode: "ES",
          targetCandidates: form.get("targetCandidates"),
          dailyCandidateCap: form.get("dailyCandidateCap"),
          resultsPerSeed: form.get("resultsPerSeed"),
          minFollowers: form.get("minFollowers"),
          maxFollowers: form.get("maxFollowers"),
          activeWithinDays: form.get("activeWithinDays"),
          scheduleIntervalHours: 24,
          autoSchedule: false,
          seeds
        })
      });
      const result = (await response.json()) as ApiResult;
      if (!response.ok || result.data === undefined) {
        setMessage(result.error?.message ?? "The campaign could not be created.");
        return;
      }
      setMessage("Campaign created in manual mode. Review it before the first run.");
      router.refresh();
    } catch {
      setMessage("The discovery service could not be reached.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="ingestForm" onSubmit={(event) => void submit(event)}>
      <div className="formHeading">
        <div>
          <p className="eyebrow">CONTROLLED DISCOVERY</p>
          <h2>Build the Spain lead universe</h2>
        </div>
        <span className="safePill">Manual launch</span>
      </div>
      <div className="formGrid">
        <label className="wideField">
          Campaign name
          <input defaultValue="Spain ICP discovery · first 500" name="name" required />
        </label>
        <label>
          Target
          <input defaultValue="500" max="5000" min="1" name="targetCandidates" type="number" />
        </label>
        <label>
          Daily candidate cap
          <input defaultValue="100" max="500" min="10" name="dailyCandidateCap" type="number" />
        </label>
        <label>
          Results per seed
          <input defaultValue="25" max="250" min="5" name="resultsPerSeed" type="number" />
        </label>
        <label>
          Active within days
          <input defaultValue="90" max="365" min="1" name="activeWithinDays" type="number" />
        </label>
        <label>
          Minimum followers
          <input defaultValue="50" min="0" name="minFollowers" type="number" />
        </label>
        <label>
          Maximum followers
          <input defaultValue="50000" min="1" name="maxFollowers" type="number" />
        </label>
        <label className="wideField">
          Food-brand search terms · one per line
          <textarea
            defaultValue={
              "marca alimentación españa\nsnacks saludables españa\nfood startup españa"
            }
            name="foodKeywords"
            rows={4}
          />
        </label>
        <label className="wideField">
          Food ecosystem source profiles · followers will be sampled
          <textarea
            defaultValue={"b3tterfoods\nprovegincubator\nbilbaoexpofoodtech"}
            name="foodProfiles"
            rows={4}
          />
        </label>
        <label className="wideField">
          Dropshipping-founder search terms · one per line
          <textarea
            defaultValue={"dropshipping españa\nfundador ecommerce españa\nshopify españa"}
            name="dropshipKeywords"
            rows={4}
          />
        </label>
        <label className="wideField">
          Dropshipping ecosystem source profiles · followers will be sampled
          <textarea
            defaultValue={"proveedoresdropship.spain\ndropshippingespana"}
            name="dropshipProfiles"
            rows={3}
          />
        </label>
      </div>
      <div className="formFooter">
        <button className="primaryButton" disabled={!enabled || pending} type="submit">
          {pending ? "Creating…" : "Create controlled campaign"}
        </button>
        {!enabled && <p className="errorText">Discovery is disabled in this environment.</p>}
        {message !== null && (
          <p className="configurationNote" role="status">
            {message}
          </p>
        )}
      </div>
    </form>
  );
}
