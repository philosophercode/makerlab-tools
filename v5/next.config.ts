import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    localPatterns: [
      {
        pathname: "/tool-images/**",
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
        hostname: "prod-files-secure.s3.us-west-2.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "s3.us-west-2.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "v5.airtableusercontent.com",
      },
    ],
    minimumCacheTTL: 3600,
  },
};

export default nextConfig;
