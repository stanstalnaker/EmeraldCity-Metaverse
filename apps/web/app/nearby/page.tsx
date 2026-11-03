import NearbyWorlds from "./NearbyWorlds";

export default function NearbyPage() {
  return (
    <main>
      <h1>Nearby worlds</h1>
      <p className="muted">
        Virtual properties linked to where you are standing. In AR each appears as a floating sphere you tap to visit; here they&apos;re
        listed nearest first.
      </p>
      <NearbyWorlds />
    </main>
  );
}
