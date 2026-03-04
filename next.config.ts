import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    localPatterns: [
      {
        pathname: "/tool-images/**",
      },
      {
        pathname: "/logo-transparent.png",
      },
      {
        pathname: "/makerlab-logo-transparent.png",
      },
      {
        pathname: "/makerlab-logo-blackonly.png",
      },
    ],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "v5.airtableusercontent.com",
      },
    ],
    minimumCacheTTL: 86400, // cache optimized images for 24 hours on Vercel CDN
  },
};

export default nextConfig;
