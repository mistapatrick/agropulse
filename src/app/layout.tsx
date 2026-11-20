import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgroPulse NG | Growthly Nexus Solutions",
  description:
    "Continuously animated observed weather telemetry across 24 Nigerian agricultural clusters, updated nightly at 23:59 WAT. A Growthly Nexus Solutions data product.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#005a5a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-brand-white text-brand-ink antialiased">
        {children}
      </body>
    </html>
  );
}
