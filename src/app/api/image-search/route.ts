import { NextRequest, NextResponse } from "next/server";
import { rateLimitAsync, getClientIp } from "@/lib/rate-limit";

interface WikiPage {
  title?: string;
  fullurl?: string;
  thumbnail?: { source?: string };
}

interface Candidate {
  title: string;
  imageUrl: string;
  pageUrl: string;
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const { allowed } = await rateLimitAsync(`imgsearch:${ip}`, { limit: 15, windowMs: 60_000 });
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }

  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!q) {
    return NextResponse.json({ error: "q required" }, { status: 400 });
  }

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: `${q} tool`,
    gsrlimit: "8",
    prop: "pageimages|info",
    inprop: "url",
    pithumbsize: "900",
    pilimit: "8",
  });

  try {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: "search failed" }, { status: 502 });
    }

    const data = await res.json();
    const pages = Object.values((data?.query?.pages || {}) as Record<string, WikiPage>);
    const candidates: Candidate[] = pages
      .map((p) => ({
        title: p.title || "Untitled",
        imageUrl: p.thumbnail?.source || "",
        pageUrl: p.fullurl || "",
      }))
      .filter((c) => c.imageUrl && c.pageUrl)
      .slice(0, 6);

    return NextResponse.json({ candidates });
  } catch {
    return NextResponse.json({ error: "search failed" }, { status: 500 });
  }
}
