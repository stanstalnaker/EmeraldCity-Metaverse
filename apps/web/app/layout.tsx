import type { Metadata } from "next";
import { Header } from "@/components/Header";
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
        <Header />
        {children}
      </body>
    </html>
  );
}
