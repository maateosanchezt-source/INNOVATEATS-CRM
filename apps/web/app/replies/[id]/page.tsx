import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppHeader } from "@/components/app-header";
import { ReplyActions } from "@/components/reply-actions";
import { requirePageActor } from "@/lib/page-auth";
import { inboundRepository } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export default async function ReplyDetailPage({
  params
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const actor = await requirePageActor();
  const { id } = await params;
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) {
    notFound();
  }
  const reply = await inboundRepository().getReply(parsed.data);
  if (reply === null) {
    notFound();
  }
  const packet = reply.packet;

  return (
    <main className="dashboardShell">
      <AppHeader actor={actor} />
      <section className="statusBanner safe">
        DRAFT ONLY · copying is allowed · this screen cannot send email
      </section>
      <section className="detailHero">
        <div>
          <Link className="backLink" href="/replies">
            ← Reply inbox
          </Link>
          <p className="eyebrow">
            PRIORITY {reply.priority} · {reply.classification.replaceAll("_", " ")}
          </p>
          <h1>{reply.brandName}</h1>
          <p>{packet.executiveSummary}</p>
          <Link className="domainLink" href={`/leads/${reply.leadId}`}>
            Open full lead record
          </Link>
        </div>
        <div className="scoreDial">
          <strong>{Math.round(reply.confidence * 100)}</strong>
          <span>CONF.</span>
        </div>
      </section>

      <section className="handoffGrid">
        <article className="summaryCard">
          <p className="eyebrow">REPLY</p>
          <h2>{reply.subject || "(no subject)"}</h2>
          <pre className="replyBody">{reply.bodyText}</pre>
        </article>
        <article className="summaryCard">
          <p className="eyebrow">QUALIFICATION</p>
          <dl className="detailList">
            {Object.entries(packet.qualification).map(([label, value]) => (
              <div key={label}>
                <dt>{label.replaceAll(/([A-Z])/gu, " $1")}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </article>
      </section>

      <section className="handoffPacket">
        <article>
          <p className="eyebrow">CONTEXT</p>
          <h2>{packet.brandAndFounder}</h2>
          <p>{packet.product}</p>
          <p>{packet.whyContacted}</p>
        </article>
        <article>
          <p className="eyebrow">PRIMARY OPPORTUNITY</p>
          <h2>{packet.primaryOpportunity}</h2>
          <p>{packet.auditAngle}</p>
        </article>
        <article>
          <p className="eyebrow">8 CALL QUESTIONS</p>
          <ol>
            {packet.callQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ol>
        </article>
        <article>
          <p className="eyebrow">RISKS</p>
          <ul>
            {packet.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </article>
        <article className="suggestedReply">
          <p className="eyebrow">SUGGESTED REPLY · NOT SENT</p>
          <pre>{packet.suggestedReply}</pre>
          <ReplyActions
            owned={reply.handoffStatus === "owned"}
            ownable={reply.priority <= 3}
            replyId={reply.id}
            suggestedReply={packet.suggestedReply}
          />
        </article>
      </section>
    </main>
  );
}
