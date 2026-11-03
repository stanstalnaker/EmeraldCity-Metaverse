"use client";

import { useState, useTransition } from "react";
import { publishStarterLayoutAction } from "@/app/market-actions";

/** For city admins of a launched city with no parcels yet: store the generated starter layout in HubID. */
export default function PublishLayout({ slug }: { slug: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <p className="notice">
      This city has no parcels yet. City administrators can publish the generated starter layout as the city&apos;s land.{" "}
      <button className="btn" disabled={pending} onClick={() => start(async () => {
        const r = await publishStarterLayoutAction(slug);
        setMsg(r.error ?? r.message ?? null);
        if (r.ok) location.reload();
      })}>
        {pending ? "Publishing…" : "Publish starter layout"}
      </button>
      {msg && <span className="muted"> {msg}</span>}
    </p>
  );
}
