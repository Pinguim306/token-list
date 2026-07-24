import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

const site =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

const description =
  "Acquire randomly selected NFT positions backed by depositor-funded standing bids — or provide backing and earn from the onchain pool.";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: "Fake World Assets — RobinhoodChain",
  description,
  openGraph: {
    title: "Fake World Assets",
    description,
    siteName: "Fake World Assets",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Fake World Assets" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Fake World Assets",
    description,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#17120f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bungee&family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
