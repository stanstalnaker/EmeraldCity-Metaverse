import Link from "next/link";
import { redirect } from "next/navigation";
import { SLUG_PATTERN } from "@/lib/cities";

const EXAMPLES = ["emerald-city", "nova-lisboa", "kyoto-bay"];

async function preview(form: FormData) {
  "use server";
  const slug = String(form.get("slug") ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (SLUG_PATTERN.test(slug)) redirect(`/cities/${slug}`);
}

export default function CitiesPage() {
  return (
    <main>
      <h1>Cities</h1>
      <p>
        Every virtual city floats as its own island. When a partner launches a city it comes with unique starter topography, generated from
        its name: a coastline, a river, a ring road and avenues, a dense core, suburbs and farmland, cut into parcels by the same rules
        everywhere.
      </p>
      <ul>
        {EXAMPLES.map((s) => (
          <li key={s}>
            <Link href={`/cities/${s}`}>{s}</Link>
          </li>
        ))}
      </ul>
      <form action={preview} className="form" style={{ maxWidth: 420 }}>
        <label>
          Preview a city name
          <input name="slug" placeholder="e.g. bermuda-bay" maxLength={48} required />
        </label>
        <button type="submit" className="btn">Generate preview</button>
      </form>
    </main>
  );
}
