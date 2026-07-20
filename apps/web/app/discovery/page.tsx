import { discoveryCandidateStatusSchema } from "@innovateats/shared";

import { AppHeader } from "@/components/app-header";
import { DiscoveryCampaignForm } from "@/components/discovery-campaign-form";
import { DiscoveryCandidateDecision } from "@/components/discovery-candidate-decision";
import { DiscoveryRunButton } from "@/components/discovery-run-button";
import { requirePageActor } from "@/lib/page-auth";
import { discoveryRepository, environment } from "@/lib/runtime";

export const dynamic = "force-dynamic";

function shortDate(value: Date | null): string {
  return value === null
    ? "—"
    : new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Madrid"
      }).format(value);
}

export default async function DiscoveryPage({
  searchParams
}: {
  readonly searchParams: Promise<{ readonly campaign?: string; readonly status?: string }>;
}) {
  const actor = await requirePageActor();
  const parameters = await searchParams;
  const campaigns = await discoveryRepository().listCampaigns();
  const selectedCampaign =
    campaigns.find((campaign) => campaign.id === parameters.campaign) ?? campaigns[0];
  const parsedStatus = discoveryCandidateStatusSchema.safeParse(parameters.status);
  const candidateStatus = parsedStatus.success ? parsedStatus.data : "needs_review";
  const [candidates, runs] = await Promise.all([
    discoveryRepository().listCandidates({
      ...(selectedCampaign === undefined ? {} : { campaignId: selectedCampaign.id }),
      status: candidateStatus,
      limit: 200
    }),
    discoveryRepository().listRuns(selectedCampaign?.id, 10)
  ]);
  const enabled = environment().DISCOVERY_ENABLED;

  return (
    <main className="dashboardShell">
      <AppHeader actor={actor} />
      <section className="statusBanner safe">
        INSTAGRAM DISCOVERY {enabled ? "ENABLED" : "DISABLED"} · PUBLIC DATA ONLY · NO DMs OR EMAILS
        ARE SENT
      </section>

      <section className="pageIntro">
        <div>
          <p className="eyebrow">LEAD DISCOVERY</p>
          <h1>Find the right accounts before outreach.</h1>
          <p>
            Spain-only sourcing, deterministic filters, permanent provenance, and a human yes/no
            gate.
          </p>
        </div>
        <span className="largeCount">{candidates.length}</span>
      </section>

      <DiscoveryCampaignForm enabled={enabled} />

      {campaigns.length > 0 && (
        <section className="discoveryCampaignGrid">
          {campaigns.map((campaign) => (
            <article className="metricCard" key={campaign.id}>
              <p className="eyebrow">{campaign.regionCode} CAMPAIGN</p>
              <h2>{campaign.name}</h2>
              <div className="campaignStats">
                <span>{campaign.candidateCount} found</span>
                <span>{campaign.needsReviewCount} to review</span>
                <span>{campaign.approvedCount} approved</span>
                <span>{campaign.runCount} runs</span>
              </div>
              <p className="cellSubtext">
                Target {campaign.targetCandidates} · last run {shortDate(campaign.lastRunAt)}
              </p>
              <DiscoveryRunButton
                campaignId={campaign.id}
                disabled={!enabled || campaign.status !== "active"}
              />
            </article>
          ))}
        </section>
      )}

      <section className="tablePanel">
        <div className="formHeading">
          <div>
            <p className="eyebrow">HUMAN REVIEW QUEUE</p>
            <h2>{selectedCampaign?.name ?? "No campaign yet"}</h2>
          </div>
          <span className="safePill">{candidateStatus.replaceAll("_", " ")}</span>
        </div>
        {candidates.length === 0 ? (
          <div className="emptyState">
            <h2>No candidates in this view.</h2>
            <p>Create a campaign, then launch a small sample.</p>
          </div>
        ) : (
          <div className="candidateGrid">
            {candidates.map((candidate) => (
              <article className="candidateCard" key={candidate.id}>
                <div className="candidateHeading">
                  <div>
                    <a href={candidate.profileUrl} rel="noreferrer" target="_blank">
                      @{candidate.username}
                    </a>
                    <span className="cellSubtext">
                      {candidate.fullName ?? candidate.businessCategory ?? "Name unavailable"}
                    </span>
                  </div>
                  <span className={`statusPill status-${candidate.status}`}>
                    {candidate.track.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="candidateBio">{candidate.biography ?? "Biography unavailable."}</p>
                <div className="campaignStats">
                  <span>{candidate.followersCount ?? "?"} followers</span>
                  <span>{candidate.postsCount ?? "?"} posts</span>
                  <span>active {shortDate(candidate.latestPostAt)}</span>
                </div>
                {candidate.externalUrl !== null && (
                  <a
                    className="textButton"
                    href={candidate.externalUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open website
                  </a>
                )}
                {candidate.filterReasons.length > 0 && (
                  <p className="candidateFlags">
                    Flags: {candidate.filterReasons.join(", ").replaceAll("_", " ")}
                  </p>
                )}
                {candidate.status === "needs_review" ? (
                  <DiscoveryCandidateDecision candidateId={candidate.id} />
                ) : (
                  <p className="cellSubtext">
                    {candidate.decisionReason} · {candidate.decidedBy}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="tablePanel">
        <div className="formHeading">
          <div>
            <p className="eyebrow">RUN OBSERVABILITY</p>
            <h2>Latest provider executions</h2>
          </div>
        </div>
        {runs.length === 0 ? (
          <p className="cellSubtext">No runs yet.</p>
        ) : (
          <div className="tableScroll">
            <table className="leadTable">
              <thead>
                <tr>
                  <th>Queued</th>
                  <th>Status</th>
                  <th>Found</th>
                  <th>Enriched</th>
                  <th>Passed filters</th>
                  <th>Flags</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{shortDate(run.queuedAt)}</td>
                    <td>{run.status}</td>
                    <td>{run.discoveredCount}</td>
                    <td>{run.enrichedCount}</td>
                    <td>{run.acceptedCount}</td>
                    <td>{run.rejectedCount}</td>
                    <td>{run.errorCode ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
