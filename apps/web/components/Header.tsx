import Link from "next/link";
import { getSession } from "@/lib/session";
import { logout } from "@/app/actions";

export async function Header() {
  const session = await getSession().catch(() => null);
  return (
    <header className="site">
      <strong>
        <Link href="/" style={{ color: "inherit", textDecoration: "none" }}>Emerald City</Link>
      </strong>
      <Link href="/map">Gaia map</Link>
      <Link href="/properties">Properties</Link>
      {session ? (
        <>
          <Link href="/my-properties">My properties</Link>
          <form action={logout}>
            <button type="submit" className="link" title={`Signed in as ${session.user.name}`}>Sign out</button>
          </form>
        </>
      ) : (
        <Link href="/login">Sign in</Link>
      )}
    </header>
  );
}
