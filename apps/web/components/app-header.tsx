import Link from "next/link";

export function AppHeader({ actor }: { readonly actor: string }) {
  return (
    <header className="topbar">
      <div className="brandCluster">
        <Link className="wordmark" href="/dashboard">
          InnovatEats
        </Link>
        <span className="productName">Outreach OS</span>
      </div>
      <nav className="primaryNav" aria-label="Primary navigation">
        <Link href="/dashboard">Safety</Link>
        <Link href="/leads">Leads</Link>
        <Link href="/replies">Replies</Link>
      </nav>
      <div className="identityBadge">{actor}</div>
    </header>
  );
}
