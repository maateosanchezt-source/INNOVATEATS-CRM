import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { contactIsActionable, icpDimensionKeys, type IcpDimensionKey } from "@innovateats/shared";

import { AppHeader } from "@/components/app-header";
import { ContactIntelligence } from "@/components/contact-intelligence";
import { EvidenceManager } from "@/components/evidence-manager";
import { MessageApprovalWorkspace } from "@/components/message-approval-workspace";
import { PipelineControl } from "@/components/pipeline-control";
import { ResearchCaptureForm } from "@/components/research-capture-form";
import { evaluateContactGate } from "@/lib/contact-policy";
import { evaluateMessageGenerationGate } from "@/lib/message-policy";
import { requirePageActor } from "@/lib/page-auth";
import { evaluateResearchGate } from "@/lib/research-policy";
import { crmRepository, environment, messageRepository, safetyControlService } from "@/lib/runtime";

export const dynamic = "force-dynamic";

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(value);
}

const dimensionLabels: Readonly<Record<IcpDimensionKey, string>> = {
  productCategory: "Product / category",
  trendFit: "Trend fit",
  outsourceability: "Outsourceability",
  stage: "Stage",
  strategicGap: "Strategic gap",
  needSignal: "Need signal",
  founderAccess: "Founder access",
  abilityToInvest: "Ability to invest",
  innovateatsDifferential: "InnovatEats differential"
};

export default async function LeadDetailPage({
  params
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const actor = await requirePageActor();
  const { id } = await params;
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) {
    notFound();
  }
  const lead = await crmRepository().getLead(parsedId.data);

  if (lead === null) {
    notFound();
  }

  let researchEnabled = false;
  let contactEnabled = false;
  let messageEnabled = false;
  const config = environment();
  if (
    config.RESEARCH_ENABLED ||
    config.CONTACT_ENRICHMENT_ENABLED ||
    config.MESSAGE_GENERATION_ENABLED
  ) {
    try {
      const safety = await safetyControlService().snapshot();
      researchEnabled = evaluateResearchGate(
        config.RESEARCH_ENABLED,
        safety,
        "secure_fetch"
      ).allowed;
      contactEnabled = evaluateContactGate(config.CONTACT_ENRICHMENT_ENABLED, safety).allowed;
      messageEnabled = evaluateMessageGenerationGate(
        config.MESSAGE_GENERATION_ENABLED,
        safety,
        "message_strategy"
      ).allowed;
    } catch {
      researchEnabled = false;
      contactEnabled = false;
      messageEnabled = false;
    }
  }
  const messageWorkspace = await messageRepository().getWorkspace(lead.id);

  return (
    <main className="dashboardShell">
      <AppHeader actor={actor} />
      <section className="statusBanner safe">
        DRY RUN ACTIVE · evidence is versioned · pipeline transitions are constrained
      </section>

      <section className="detailHero">
        <div>
          <Link className="backLink" href="/leads">
            ← Lead inbox
          </Link>
          <p className="eyebrow">
            {lead.regionCode ?? "UNASSIGNED"} · {lead.stage}
          </p>
          <h1>{lead.brandName}</h1>
          <p>{lead.productSummary ?? "Product summary pending manual research."}</p>
          <a
            className="domainLink"
            href={`https://${lead.canonicalDomain}`}
            rel="noreferrer"
            target="_blank"
          >
            {lead.canonicalDomain}
          </a>
        </div>
        <div className="scoreDial" aria-label={`Preliminary ICP score ${lead.score}`}>
          <strong>{lead.score}</strong>
          <span>ICP</span>
        </div>
      </section>

      <section className="detailGrid">
        <article className="summaryCard">
          <p className="eyebrow">WHY NOW</p>
          <h2>{lead.discoverySignal ?? "No discovery signal recorded"}</h2>
          <dl className="detailList">
            <div>
              <dt>Country</dt>
              <dd>{lead.country}</dd>
            </div>
            <div>
              <dt>Score confidence</dt>
              <dd>{Math.round(lead.scoreConfidence * 100)}%</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{lead.currentOwner ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>Discovered</dt>
              <dd>{formatDate(lead.firstDiscoveredAt)}</dd>
            </div>
          </dl>
        </article>
        <PipelineControl currentStatus={lead.status} leadId={lead.id} />
      </section>

      <section className="researchGrid">
        <article className="controlCard">
          <p className="eyebrow">PUBLIC RESEARCH</p>
          <h2>Capture, pin, hash.</h2>
          <p className="mutedText">
            DNS is revalidated and pinned, redirects are checked, robots rules are enforced, and
            scripts never execute.
          </p>
          <ResearchCaptureForm
            defaultUrl={`https://${lead.canonicalDomain}`}
            enabled={researchEnabled}
            leadId={lead.id}
          />
        </article>
        <article className="summaryCard">
          <p className="eyebrow">ENTITY</p>
          <h2>{lead.founders.length > 0 ? "Founder evidence" : "Founder pending"}</h2>
          {lead.founders.length === 0 ? (
            <p className="mutedText">
              Entity resolution has not attached a founder with sufficient confidence.
            </p>
          ) : (
            <ul className="founderList">
              {lead.founders.map((founder) => (
                <li key={founder.id}>
                  <strong>{founder.name}</strong>
                  <span>{founder.role}</span>
                  <small>{Math.round(founder.confidence * 100)}% confidence</small>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <ContactIntelligence
        contacts={lead.contacts.map((contact) => ({
          id: contact.id,
          channelType: contact.channelType,
          value: contact.value,
          directUrl: contact.directUrl,
          sourceUrl: contact.sourceUrl,
          provenance: contact.provenance,
          origin: contact.origin,
          verificationStatus: contact.verificationStatus,
          verificationProvider: contact.verificationProvider,
          confidence: contact.confidence,
          doNotContact: contact.doNotContact
        }))}
        enabled={contactEnabled}
        evidenceOptions={lead.evidence
          .filter(
            (record) => record.factType === "source_snapshot" && record.sourceDocumentId !== null
          )
          .map((record) => ({ id: record.id, sourceUrl: record.sourceUrl }))}
        leadId={lead.id}
      />

      <MessageApprovalWorkspace
        contacts={lead.contacts.map((contact) => ({
          id: contact.id,
          label: `${contact.fullName ?? contact.role ?? "Business contact"} · ${contact.value}`,
          actionable:
            !contact.doNotContact &&
            (contact.channelType === "corporate_email" ||
              contact.channelType === "named_business_email") &&
            contactIsActionable(contact.origin, contact.verificationStatus)
        }))}
        defaultDiscoveryFact={
          lead.discoverySignal ?? "An official public source documents the current product."
        }
        defaultBrand={lead.brandName}
        defaultProduct={lead.productSummary ?? `${lead.brandName} food product`}
        enabled={messageEnabled && lead.status === "contact_found"}
        evidence={lead.evidence.map((record) => ({
          id: record.id,
          claim: record.claim,
          sourceUrl: record.sourceUrl
        }))}
        leadId={lead.id}
        workspace={{
          brief:
            messageWorkspace.brief === null
              ? null
              : {
                  diagnosis: messageWorkspace.brief.diagnosis,
                  opportunity: messageWorkspace.brief.opportunity,
                  mateoFit: messageWorkspace.brief.mateoFit,
                  brief: messageWorkspace.brief.brief
                },
          drafts: messageWorkspace.drafts.map((draft) => ({
            ...draft,
            createdAt: draft.createdAt.toISOString(),
            approval:
              draft.approval === null
                ? null
                : {
                    ...draft.approval,
                    createdAt: draft.approval.createdAt.toISOString()
                  }
          }))
        }}
      />

      {lead.latestScore !== null && (
        <section className="scoreSection">
          <div className="sectionHeading">
            <div>
              <p className="eyebrow">ICP {lead.latestScore.rubricVersion}</p>
              <h2>Why this score is {lead.latestScore.total}/100</h2>
            </div>
            <span className="countPill">
              {lead.latestScore.recommendedAction.replaceAll("_", " ")}
            </span>
          </div>
          <div className="scoreBreakdown">
            {icpDimensionKeys.map((dimension) => (
              <article key={dimension}>
                <div>
                  <strong>{dimensionLabels[dimension]}</strong>
                  <span>{lead.latestScore?.breakdown[dimension]}</span>
                </div>
                <p>{lead.latestScore?.explanations[dimension]}</p>
              </article>
            ))}
          </div>
          {lead.latestScore.missingInformation.length > 0 && (
            <p className="scoreMissing">
              Missing: {lead.latestScore.missingInformation.join(" · ")}
            </p>
          )}
        </section>
      )}

      <EvidenceManager
        leadId={lead.id}
        records={lead.evidence.map((record) => ({
          ...record,
          observedAt: record.observedAt.toISOString()
        }))}
      />

      <section className="timelineSection">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">TIMELINE</p>
            <h2>Pipeline history</h2>
          </div>
        </div>
        <ol className="timelineList">
          {lead.history.map((entry) => (
            <li key={entry.id}>
              <span className="timelineDot" />
              <div>
                <strong>{entry.toStatus.replaceAll("_", " ")}</strong>
                <p>{entry.reason ?? "State updated"}</p>
                <small>
                  {formatDate(entry.createdAt)} · {entry.actorId}
                </small>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
