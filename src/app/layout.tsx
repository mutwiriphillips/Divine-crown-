import type { Metadata, Viewport } from "next";
import "@fontsource/young-serif/400.css";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/instrument-sans/700.css";
import "./globals.css";
import { getSetting } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const b = await getSetting("business").catch(() => null);
  return {
    title: { default: b?.name ?? "Shop", template: `%s · ${b?.name ?? "Shop"}` },
    description: b?.tagline || "Traditional oils, soaps, powders and incense.",
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#3A1631" };

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
