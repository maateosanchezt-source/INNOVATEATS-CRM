"use client";

import { createAuthClient } from "better-auth/react";
import { useState } from "react";

const authClient = createAuthClient();

export function GoogleSignInButton({ enabled }: { readonly enabled: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(): Promise<void> {
    if (!enabled || pending) {
      return;
    }

    setPending(true);
    setError(null);
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/dashboard"
    });

    if (result.error !== null) {
      setError("Google sign-in could not start. Check the OAuth configuration.");
      setPending(false);
    }
  }

  return (
    <>
      <button
        className="primaryButton fullWidth"
        disabled={!enabled || pending}
        onClick={() => void signIn()}
        type="button"
      >
        {pending ? "Opening Google…" : "Continue with Google"}
      </button>
      {error !== null && (
        <p className="errorText" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
