"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface RegionView {
  readonly regionId: string;
  readonly code: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly defaultLanguage: string;
  readonly timezoneStrategy: string;
  readonly policyMode: string;
  readonly version: string | null;
  readonly policy: {
    readonly rules: readonly string[];
    readonly sources: readonly { readonly authority: string; readonly url: string }[];
  } | null;
}

export function RegionPolicySettings({ regions }: { readonly regions: readonly RegionView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function update(region: RegionView) {
    const enabled = !region.enabled;
    const confirmation = window.prompt(
      `Type ${region.code} to ${enabled ? "enable" : "disable"} this region.`
    );
    if (confirmation === null) {
      return;
    }
    setBusy(region.code);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/regions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: region.code,
          enabled,
          confirmCode: confirmation
        })
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Region update failed.");
      }
      setNotice(
        `${region.code} ${enabled ? "enabled" : "disabled"}. Production remains governed by every independent send gate.`
      );
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Region update failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {notice !== null && <p className="decisionRecord">{notice}</p>}
      <div className="policyGrid">
        {regions.map((region) => (
          <article className="summaryCard" key={region.regionId}>
            <div className="contactCardTop">
              <div>
                <p className="eyebrow">{region.code}</p>
                <h2>{region.name}</h2>
              </div>
              <span className={`modePill ${region.enabled ? "sandbox" : "dry_run"}`}>
                {region.enabled ? "enabled" : "disabled"}
              </span>
            </div>
            <dl className="detailList">
              <div>
                <dt>Policy</dt>
                <dd>{region.policyMode.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{region.version ?? "missing"}</dd>
              </div>
              <div>
                <dt>Language</dt>
                <dd>{region.defaultLanguage}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>{region.timezoneStrategy.replaceAll("_", " ")}</dd>
              </div>
            </dl>
            {region.policy === null ? (
              <p className="gateNotice">No active policy: enabling is impossible.</p>
            ) : (
              <>
                <ul>
                  {region.policy.rules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
                <p className="sourceLinks">
                  {region.policy.sources.map((source) => (
                    <a href={source.url} key={source.url} rel="noreferrer" target="_blank">
                      {source.authority}
                    </a>
                  ))}
                </p>
              </>
            )}
            <button
              className={region.enabled ? "secondaryButton" : "primaryButton"}
              disabled={busy !== null || region.policy === null}
              onClick={() => void update(region)}
              type="button"
            >
              {busy === region.code
                ? "Applying…"
                : region.enabled
                  ? "Disable region"
                  : "Enable with typed confirmation"}
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
