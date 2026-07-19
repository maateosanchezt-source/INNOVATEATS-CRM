import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SafetyControlService } from "@innovateats/feature-flags";
import { isAuthorizedEmail } from "@innovateats/shared";

import { buildDashboardModel } from "@/lib/dashboard-model";
import { environment, inboundRepository, internalAuth, safetyControlService } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const requestHeaders = await headers();
  const session = await internalAuth().api.getSession({ headers: requestHeaders });
  const config = environment();

  if (session === null || !isAuthorizedEmail(session.user.email, config.AUTHORIZED_EMAIL)) {
    redirect("/sign-in");
  }

  let snapshot;
  try {
    snapshot = await safetyControlService().snapshot();
  } catch {
    snapshot = SafetyControlService.safestPossibleSnapshot();
  }
  const model = buildDashboardModel(snapshot);
  const unreadReplies = await inboundRepository().countUnreadNotifications(config.AUTHORIZED_EMAIL);

  return (
    <main className="dashboardShell">
      <AppHeader actor={session.user.email} />

      <section className={`statusBanner ${model.status}`}>{model.banner}</section>

      <section className="dashboardIntro">
        <p className="eyebrow">FOUNDATIONS CONTROL PLANE</p>
        <h1>System safety</h1>
        <p>
          Phase 0 exposes the controls that every later workflow must pass. No provider execution is
          available yet.
        </p>
      </section>

      <section className="cardGrid" aria-label="Safety controls">
        {model.cards.map((card) => (
          <article className={`metricCard ${card.tone}`} key={card.label}>
            <p>{card.label}</p>
            <strong>{card.value}</strong>
          </article>
        ))}
      </section>

      <section className="foundationPanel">
        <div>
          <p className="eyebrow">MANDATORY TRUST SIGNAL</p>
          <h2>Every email includes InnovatEats</h2>
          <p>Message validation blocks approval when the exact website is absent.</p>
        </div>
        <a href="https://innovateats.com">https://innovateats.com</a>
      </section>
      <section className="foundationPanel">
        <div>
          <p className="eyebrow">HUMAN HANDOFF</p>
          <h2>{unreadReplies} priority replies need attention</h2>
          <p>Every matched reply stops its sequence before Mateo reviews the draft.</p>
        </div>
        <Link href="/replies">Open reply inbox →</Link>
      </section>
      <section className="foundationPanel">
        <div>
          <p className="eyebrow">CRM CORE</p>
          <h2>Manual research pipeline</h2>
          <p>Ingest public URLs, curate evidence, and move leads through audited states.</p>
        </div>
        <Link href="/leads">Open lead inbox →</Link>
      </section>
    </main>
  );
}
import { AppHeader } from "@/components/app-header";
