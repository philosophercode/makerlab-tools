import { NextRequest, NextResponse } from "next/server";
import { rateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { lookup } from "dns/promises";
import net from "net";

const SCRIPTS_DIR = path.resolve(process.cwd(), "..", "scripts");
const PUBLIC_IMAGES_DIR = path.resolve(process.cwd(), "public", "tool-images");
const NOBG_DIR = path.join(SCRIPTS_DIR, "tool_images_nobg");
const GENERATED_DIR = path.join(SCRIPTS_DIR, "tool_images_generated");
const ALLOWED_IMAGE_HOSTS = new Set([
  "upload.wikimedia.org",
  "commons.wikimedia.org",
  "wikipedia.org",
  "images.unsplash.com",
  "images.pexels.com",
]);

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    if (ip.startsWith("10.")) return true;
    if (ip.startsWith("127.")) return true;
    if (ip.startsWith("192.168.")) return true;
    const parts = ip.split(".").map(Number);
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (ip === "0.0.0.0") return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::1") return true;
    if (v.startsWith("fc") || v.startsWith("fd")) return true; // ULA
    if (v.startsWith("fe80:")) return true; // link-local
    return false;
  }
  return true;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function validateSourceUrl(raw: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "Invalid sourceUrl";
  }

  if (parsed.protocol !== "https:") {
    return "Only https source URLs are allowed";
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return "Host is not allowed";
  }

  const hostAllowed = [...ALLOWED_IMAGE_HOSTS].some(
    (h) => hostname === h || hostname.endsWith(`.${h}`)
  );
  if (!hostAllowed) {
    return "Source host is not allowed";
  }

  // Defense in depth against DNS-based SSRF.
  try {
    const resolved = await lookup(hostname, { all: true });
    if (resolved.some((r) => isPrivateIp(r.address))) {
      return "Resolved address is not allowed";
    }
  } catch {
    return "Could not resolve source host";
  }

  return null;
}

/**
 * GET /api/image?toolName=xxx&since=timestamp
 * Polls whether the image has been updated since a given timestamp.
 */
export async function GET(req: NextRequest) {
  const toolName = req.nextUrl.searchParams.get("toolName");
  const since = Number(req.nextUrl.searchParams.get("since") || "0");

  if (!toolName) {
    return NextResponse.json({ error: "toolName required" }, { status: 400 });
  }

  const safeName = toolName.replace(/\//g, "_");
  const imagePath = path.join(PUBLIC_IMAGES_DIR, `${safeName}.png`);

  try {
    const stat = await fs.stat(imagePath);
    const modifiedAt = stat.mtimeMs;
    const done = modifiedAt > since;
    return NextResponse.json({ done, modifiedAt });
  } catch {
    return NextResponse.json({ done: false, modifiedAt: 0 });
  }
}

/**
 * POST /api/image
 * Kicks off image regeneration or background removal as a detached
 * background process. Returns immediately — client polls GET for completion.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { allowed } = await rateLimitAsync(`image:${ip}`, { limit: 5, windowMs: 60_000 });
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }

  let body: { toolName: string; action: string; sourceUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { toolName, action, sourceUrl } = body;

  if (!toolName || typeof toolName !== "string") {
    return NextResponse.json({ error: "toolName required" }, { status: 400 });
  }
  if (toolName.length > 200) {
    return NextResponse.json({ error: "toolName too long" }, { status: 400 });
  }

  if (!["regenerate", "remove-bg", "replace-from-url"].includes(action)) {
    return NextResponse.json(
      { error: "action must be 'regenerate', 'remove-bg', or 'replace-from-url'" },
      { status: 400 }
    );
  }

  if (action === "replace-from-url") {
    if (!sourceUrl || typeof sourceUrl !== "string") {
      return NextResponse.json(
        { error: "sourceUrl required for replace-from-url" },
        { status: 400 }
      );
    }
    const validationError = await validateSourceUrl(sourceUrl);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
  }

  const imageTaskScript = path.join(
    "scripts",
    process.env.IMAGE_TASK_SCRIPT_NAME || "run-image-task.mjs"
  );
  const cmdParts = [
    "node",
    shellQuote(imageTaskScript),
    "--action",
    shellQuote(action),
    "--tool",
    shellQuote(toolName),
  ];
  if (action === "replace-from-url" && sourceUrl) {
    cmdParts.push("--sourceUrl", shellQuote(sourceUrl));
  }
  const cmd = cmdParts.join(" ");

  // Spawn detached — process continues even if HTTP connection drops.
  const child = spawn("sh", ["-lc", cmd], {
    detached: true,
    stdio: "ignore",
    env: process.env,
    cwd: process.cwd(),
  });
  child.unref();

  return NextResponse.json({
    success: true,
    started: true,
    action,
    message: `${action} started in background — poll GET /api/image for completion`,
  });
}
