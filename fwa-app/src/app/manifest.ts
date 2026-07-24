import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fake World Assets",
    short_name: "FWA",
    description:
      "Acquire randomly selected NFT positions backed by depositor-funded standing bids on RobinhoodChain.",
    start_url: "/",
    display: "standalone",
    background_color: "#17120f",
    theme_color: "#17120f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
