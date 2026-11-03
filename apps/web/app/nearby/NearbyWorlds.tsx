"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { HubAnchor as BaseAnchor } from "@emerald-city/hubid-client";

type HubAnchor = BaseAnchor & { title?: string; thumbnail?: string | null };

type State = { kind: "idle" } | { kind: "locating" } | { kind: "error"; message: string } | { kind: "done"; items: HubAnchor[] };

const TRUST_LABEL: Record<string, string> = { place: "real place", presence: "checked in", resident: "resident", owner: "land owner" };

export default function NearbyWorlds() {
  const [state, setState] = useState<State>({ kind: "idle" });

  const locate = () => {
    if (!("geolocation" in navigator)) return setState({ kind: "error", message: "This browser can't share your location." });
    setState({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const q = new URLSearchParams({ lat: String(pos.coords.latitude), lng: String(pos.coords.longitude), radius: "300" });
        const res = await fetch(`/api/anchors/near?${q}`);
        if (!res.ok) return setState({ kind: "error", message: "Couldn't reach HubID." });
        setState({ kind: "done", items: ((await res.json()) as { items: HubAnchor[] }).items });
      },
      () => setState({ kind: "error", message: "Location permission was denied." }),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  useEffect(() => {
    // Only start automatically if permission was already granted.
    navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((p) => p.state === "granted" && locate()).catch(() => undefined);
  }, []);

  if (state.kind === "idle") return <button className="btn" onClick={locate}>Find worlds near me</button>;
  if (state.kind === "locating") return <p className="muted">Finding your location…</p>;
  if (state.kind === "error") return <p className="error">{state.message}</p>;
  if (state.items.length === 0) return <p className="muted">No worlds are linked to this place yet.</p>;
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      {state.items.map((a) => (
        <Link key={a.id} href={a.kind === "virtual-property" ? `/p/${a.ref}` : "#"} className="card nearby-item">
          <span className="sphere" aria-hidden />
          <span>
            <strong>{a.title ?? (a.kind === "virtual-property" ? `Property ${a.ref}` : "Artifact")}</strong>
            <br />
            <span className="muted">{Math.round(Number(a.distance_m ?? 0))} m away{a.address ? ` · ${a.address}` : ""}</span>
            <br />
            {a.trust !== "unverified" && <span className="badge">verified: {TRUST_LABEL[a.trust] ?? a.trust}</span>}
          </span>
        </Link>
      ))}
    </div>
  );
}
