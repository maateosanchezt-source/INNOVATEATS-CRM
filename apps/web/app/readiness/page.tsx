import { modelRoutingPlan } from "@innovateats/config";

import { AppHeader } from "@/components/app-header";
import { DataGovernanceControls } from "@/components/data-governance-controls";
import { ReadinessControls } from "@/components/readiness-controls";
import { requirePageActor } from "@/lib/page-auth";
import { environment, metricsRepository, readinessRepository } from "@/lib/runtime";

export const dynamic = "force-dynamic";

function percent(value: number | null): string {
  return value === null ? "Awaiting data" : `${(value * 100).toFixed(1)}%`;
}

export default async function ReadinessPage() {
  const actor = await requirePageActor();
  const metrics = metricsRepository();
  const [snapshot, funnel, quality, deliverability, costs] = await Promise.all([
    readinessRepository().snapshot(),
    metrics.funnel(),
    metrics.quality(),
    metrics.deliverability(),
    metrics.costs()
  ]);
  const routes = modelRoutingPlan(environment());

  return (
    <main className="dashboardShell">
      <AppHeader actor={actor} />
      <section className="statusBanner danger">
        Production locked - a green automated suite is not pilot approval or go-live authorization
      </section>
      <section className="pageIntro">
        <div>
          <p className="eyebrow">PHASE 8 CONTROL ROOM</p>
          <h1>Evaluation and pilot readiness</h1>
          <p>
            Deterministic acceptance, real-outcome gates, model routing, costs and the evidence
            required before any external pilot can be proposed.
          </p>
        </div>
      </section>

      <section className="cardGrid" aria-label="Readiness summary">
        <article className="metricCard">
          <p>Automated suite</p>
          <strong>
            {snapshot.latestEval?.automatedPassed === true
              ? "Passed"
              : snapshot.latestEval === null
                ? "Not run"
                : "Failed"}
          </strong>
        </article>
        <article className="metricCard danger">
          <p>Pilot ready</p>
          <strong>{snapshot.latestEval?.pilotReady === true ? "Yes" : "No"}</strong>
        </article>
        <article className="metricCard">
          <p>Checklist</p>
          <strong>
            {snapshot.checklistPassed}/{snapshot.checklistTotal}
          </strong>
        </article>
        <article className="metricCard danger">
          <p>Production</p>
          <strong>Locked</strong>
        </article>
      </section>

      <section className="readinessMetrics">
        <article className="summaryCard">
          <p className="eyebrow">FUNNEL</p>
          <h2>{funnel.totalLeads} leads</h2>
          <p>{funnel.strongLeads} currently score as strong ICP.</p>
        </article>
        <article className="summaryCard">
          <p className="eyebrow">QUALITY</p>
          <h2>{percent(quality.evidenceMappingCoverage)}</h2>
          <p>
            Evidence coverage - human quality{" "}
            {quality.averageHumanScore === null
              ? "awaiting reviews"
              : `${quality.averageHumanScore.toFixed(2)}/5`}
          </p>
        </article>
        <article className="summaryCard">
          <p className="eyebrow">DELIVERABILITY</p>
          <h2>{percent(deliverability.bounceRate)}</h2>
          <p>
            Bounce rate - {deliverability.spamComplaints} complaints -{" "}
            {deliverability.suppressionViolations} suppression violations
          </p>
        </article>
        <article className="summaryCard">
          <p className="eyebrow">COST</p>
          <h2>${costs.costUsdMonth.toFixed(2)}</h2>
          <p>
            Month -{" "}
            {costs.costPerQualifiedLeadUsd === null
              ? "no cost/qualified lead yet"
              : `$${costs.costPerQualifiedLeadUsd.toFixed(2)} per qualified lead`}
          </p>
        </article>
      </section>

      <section className="foundationPanel">
        <div>
          <p className="eyebrow">CONTROLLED PILOT PLAN</p>
          <h2>{snapshot.pilot?.name ?? "Created when the evaluation first runs"}</h2>
          <p>
            50 leads - US and UK corporate only - maximum 10 emails/day - human approval on every
            message - review every 20 - maximum 14 days.
          </p>
        </div>
        <span className="modePill dry_run">
          {snapshot.pilot?.mode ?? "simulation"} / {snapshot.pilot?.status ?? "not created"}
        </span>
      </section>

      <section className="summaryCard modelRoutePanel">
        <p className="eyebrow">MODEL ROUTING</p>
        <h2>Strong baseline by task</h2>
        <div className="routeGrid">
          {routes.map((route) => (
            <div key={route.task}>
              <strong>{route.task}</strong>
              <span>{route.configured ? route.model : `Missing ${route.environmentKey}`}</span>
            </div>
          ))}
        </div>
      </section>

      <ReadinessControls checklist={snapshot.checklist} />
      <DataGovernanceControls />
    </main>
  );
}
