import Link from "next/link";

import { googleOAuthIsConfigured } from "@innovateats/config";

import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { environment } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  const config = environment();
  const googleConfigured = googleOAuthIsConfigured(config);

  return (
    <main className="shell centered">
      <section className="authCard">
        <Link className="wordmark" href="/">
          InnovatEats
        </Link>
        <p className="eyebrow">OUTREACH OS</p>
        <h1>Internal access</h1>
        <p>Access is restricted to the verified Google identity configured for Mateo.</p>
        <GoogleSignInButton enabled={googleConfigured} />
        {!googleConfigured && (
          <p className="configurationNote" role="status">
            Google OAuth is not configured. Add the client ID and secret to the local environment;
            development never invents credentials.
          </p>
        )}
        <p className="authorizedIdentity">
          Authorized identity: <strong>{config.AUTHORIZED_EMAIL}</strong>
        </p>
      </section>
    </main>
  );
}
