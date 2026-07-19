import Link from "next/link";

import { leadStatuses, leadStatusSchema } from "@innovateats/shared";

import { AppHeader } from "@/components/app-header";
import { ManualLeadForm } from "@/components/manual-lead-form";
import { requirePageActor } from "@/lib/page-auth";
import { crmRepository } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams
}: {
  readonly searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const actor = await requirePageActor();
  const parameters = await searchParams;
  const parsedStatus = leadStatusSchema.safeParse(parameters.status);
  const status = parsedStatus.success ? parsedStatus.data : undefined;
  const leads = await crmRepository().listLeads({
    ...(status === undefined ? {} : { status }),
    ...(parameters.search === undefined ? {} : { search: parameters.search })
  });

  return (
    <main className="dashboardShell">
      <AppHeader actor={actor} />
      <section className="statusBanner safe">
        DRY RUN ACTIVE · CRM changes are audited · no agent or sender is invoked
      </section>

      <section className="pageIntro">
        <div>
          <p className="eyebrow">LEAD INBOX</p>
          <h1>Qualified context, one brand at a time.</h1>
          <p>Manual research starts here. Duplicate domains resolve to the existing lead.</p>
        </div>
        <span className="largeCount">{leads.length}</span>
      </section>

      <ManualLeadForm />

      <section className="tablePanel">
        <form className="filterBar">
          <input
            defaultValue={parameters.search}
            name="search"
            placeholder="Search brand, product, or domain"
          />
          <select defaultValue={status ?? ""} name="status">
            <option value="">All pipeline states</option>
            {leadStatuses.map((leadStatus) => (
              <option key={leadStatus} value={leadStatus}>
                {leadStatus.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <button className="secondaryButton" type="submit">
            Filter
          </button>
          <Link className="textButton" href="/leads">
            Reset
          </Link>
        </form>

        {leads.length === 0 ? (
          <div className="emptyState">
            <h2>No leads match this view.</h2>
            <p>Add a public URL or clear the filters.</p>
          </div>
        ) : (
          <div className="tableScroll">
            <table className="leadTable">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Product</th>
                  <th>Region</th>
                  <th>Stage</th>
                  <th>Score</th>
                  <th>Evidence</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      <Link className="leadLink" href={`/leads/${lead.id}`}>
                        {lead.brandName}
                      </Link>
                      <span className="cellSubtext">{lead.country}</span>
                    </td>
                    <td>{lead.productSummary ?? "Research pending"}</td>
                    <td>{lead.regionCode ?? "—"}</td>
                    <td>{lead.stage.replaceAll("_", " ")}</td>
                    <td>
                      <span className="scoreBadge">{lead.score}</span>
                    </td>
                    <td>{lead.evidenceCount}</td>
                    <td>
                      <span className={`statusPill status-${lead.status}`}>
                        {lead.status.replaceAll("_", " ")}
                      </span>
                    </td>
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
