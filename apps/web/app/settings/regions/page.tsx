import { AppHeader } from "@/components/app-header";
import { RegionPolicySettings } from "@/components/region-policy-settings";
import { requirePageActor } from "@/lib/page-auth";
import { complianceRepository } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export default async function RegionSettingsPage() {
  const actor = await requirePageActor();
  const regions = await complianceRepository().listRegionPolicies();
  return (
    <main className="dashboardShell">
      <AppHeader actor={actor} />
      <section className="statusBanner warning">
        A region switch never opens production by itself · global dry run and explicit go-live
        remain independent
      </section>
      <section className="pageIntro">
        <div>
          <p className="eyebrow">VERSIONED COMPLIANCE</p>
          <h1>Regional policy controls</h1>
          <p>
            Every decision stores its exact policy snapshot. Changed, retired or disabled policy
            state fails closed at send time.
          </p>
        </div>
      </section>
      <RegionPolicySettings regions={regions} />
    </main>
  );
}
