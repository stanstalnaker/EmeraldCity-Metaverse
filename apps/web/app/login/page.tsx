import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getSession()) redirect(next?.startsWith("/") && !next.startsWith("//") ? next : "/my-properties");
  return (
    <main style={{ maxWidth: 420 }}>
      <h1>Sign in with HubID</h1>
      <LoginForm next={next} />
      <p className="muted">
        No HubID yet? <a href="https://hubculture.com">Join Hub Culture</a>.
      </p>
    </main>
  );
}
