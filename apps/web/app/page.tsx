import Link from "next/link";

export default function HomePage() {
  return (
    <main className="shell landing">
      <section className="hero">
        <p className="eyebrow">INNOVATEATS · INTERNAL SYSTEM</p>
        <h1>Outreach built on evidence, not volume.</h1>
        <p className="lede">
          Research, qualification, policy, approvals, and handoff in one controlled operating
          system.
        </p>
        <div className="heroActions">
          <Link className="primaryButton" href="/sign-in">
            Sign in as Mateo
          </Link>
          <a className="secondaryButton" href="https://innovateats.com">
            innovateats.com
          </a>
        </div>
      </section>
      <section className="safetyStrip" aria-label="Current safety status">
        <span className="pulse" aria-hidden="true" />
        Phase 0 · dry-run only · email disabled
      </section>
    </main>
  );
}
