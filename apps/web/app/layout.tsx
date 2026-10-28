import type { Metadata } from "next";
import Link from "next/link";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Emerald City",
  description: "Hub Culture's Emerald City: properties, people and agents on the Gaia map.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <strong>Emerald City</strong>
          <Link href="/map">Gaia map</Link>
          <Link href="/properties">Properties</Link>
        </header>
        {children}
      </body>
    </html>
  );
}
