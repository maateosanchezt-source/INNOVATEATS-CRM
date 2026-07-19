import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppHeader } from "@/components/app-header";
import { EvidenceManager } from "@/components/evidence-manager";
import { PipelineControl } from "@/components/pipeline-control";
import { requirePageActor } from "@/lib/page-auth";
import { crmRepository } from "@/lib/runtime";

export const dynamic = "force-dynamic";

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(value);
}

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
