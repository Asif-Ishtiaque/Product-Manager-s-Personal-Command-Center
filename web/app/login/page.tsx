import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/board");
  const { error } = await searchParams;

  async function googleSignIn() {
    "use server";
    await signIn("google", { redirectTo: "/board" });
  }

  async function emailSignIn(formData: FormData) {
    "use server";
    const email = String(formData.get("email") || "").trim();
    await signIn("resend", { email, redirectTo: "/board" });
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>
          Tide<span className="dot">.</span>
        </h1>
        <p className="lead">Sign in to your workspace. No passwords — use Google or a magic link.</p>

        {error && <div className="banner err">Couldn&apos;t sign you in. Please try again.</div>}

        <div className="login-form">
          <form action={googleSignIn}>
            <button type="submit" className="btn google block">
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
                <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
              </svg>
              Continue with Google
            </button>
          </form>

          <div className="divider">OR</div>

          <form action={emailSignIn} className="login-form">
            <input className="input" type="email" name="email" placeholder="you@company.com" required autoComplete="email" />
            <button type="submit" className="btn amber block">Send magic link</button>
          </form>
        </div>

        <p className="note">Sessions are server-side — logging out fully revokes access.</p>
      </div>
    </div>
  );
}
