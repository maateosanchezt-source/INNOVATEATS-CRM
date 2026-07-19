import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { requirePageActor } from "@/lib/page-auth";
import { environment, inboundRepository } from "@/lib/runtime";

export const dynamic = "force-dynamic";

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(value);
}

export default async function RepliesPage() {
  const actor = await requirePageActor();
  const [replies, unread] = await Promise.all([
    inboundRepository().listReplies(),
    inboundRepository().countUnreadNotifications(environment().AUTHORIZED_EMAIL)
  ]);

  return (
    <main className="dashboardShell">
      <AppHeader actor={actor} />
      <section className="statusBanner safe">
        HUMAN HANDOFF ONLY · sequences stop on every matched reply · no automatic replies
      </section>
      <section className="pageIntro">
        <div>
          <p className="eyebrow">REPLY INBOX</p>
          <h1>Intent first. Mateo stays in control.</h1>
          <p>Prioritized by reply type; message bodies are never executed as instructions.</p>
        </div>
        <span className="largeCount" aria-label={`${unread} unread priority replies`}>
          {unread}
        </span>
      </section>
      {replies.length === 0 ? (
        <section className="emptyState">
          <h2>No CRM replies yet.</h2>
          <p>Inbound Gmail remains off until its restricted scope is explicitly approved.</p>
        </section>
      ) : (
        <section className="replyList">
          {replies.map((reply) => (
            <article className={`replyCard priority-${reply.priority}`} key={reply.id}>
              <div className="replyCardHeading">
                <div>
                  <p className="eyebrow">
                    PRIORITY {reply.priority} · {reply.classification.replaceAll("_", " ")}
                  </p>
                  <h2>{reply.brandName}</h2>
                  <p>
                    {reply.fromAddress} · {formatDate(reply.receivedAt)}
                  </p>
                </div>
                <span className="countPill">{Math.round(reply.confidence * 100)}%</span>
              </div>
              <h3>{reply.subject || "(no subject)"}</h3>
              <p className="replyPreview">{reply.bodyText.slice(0, 400)}</p>
              <div className="replyCardFooter">
                <span>{reply.handoffStatus === "owned" ? "Mateo-owned" : "Handoff ready"}</span>
                <Link href={`/replies/${reply.id}`}>Open handoff →</Link>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
