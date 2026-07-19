"use client";

import { useState } from "react";

export function DataGovernanceControls() {
  const [leadId, setLeadId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function erase() {
    const normalized = leadId.trim();
    const confirmation = window.prompt(
      `This is irreversible active-data anonymization. Type ERASE ${normalized} to continue.`
    );
    if (confirmation === null) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/data-governance/erase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: normalized, confirmation })
      });
      const payload = (await response.json()) as {
        data?: { contactsAnonymized?: number; foundersAnonymized?: number };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Erasure failed.");
      }
      setNotice(
        `Active PII anonymized: ${payload.data?.contactsAnonymized ?? 0} contacts and ${payload.data?.foundersAnonymized ?? 0} founders.`
      );
      setLeadId("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Erasure failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="summaryCard dataGovernancePanel">
      <p className="eyebrow">DATA GOVERNANCE</p>
      <h2>Export or erase safely</h2>
      <p>
        Export all CRM data owned by Mateo. Erasure is limited to rejected, never-scheduled leads;
        immutable evidence and audit history remain retained and disclosed.
      </p>
      <div className="dataGovernanceActions">
        <a className="secondaryButton" href="/api/data-governance/export">
          Download JSON export
        </a>
        <input
          aria-label="Rejected lead ID to erase"
          onChange={(event) => setLeadId(event.target.value)}
          placeholder="Rejected lead UUID"
          type="text"
          value={leadId}
        />
        <button
          className="secondaryButton"
          disabled={busy || leadId.trim() === ""}
          onClick={() => void erase()}
          type="button"
        >
          {busy ? "Erasing..." : "Erase active PII"}
        </button>
      </div>
      {notice !== null && <p className="decisionRecord">{notice}</p>}
    </section>
  );
}
