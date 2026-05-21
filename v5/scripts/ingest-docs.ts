#!/usr/bin/env tsx
/**
 * Offline ingestion script for tool documentation PDFs attached to Notion
 * Resources. Extracts the full text of each PDF and writes
 * v5/src/lib/docs-text.json — a JSON map of tool_id → resources keyed by tool.
 *
 * No embeddings, no chunking. The chat route stuffs the full text of all
 * docs for the focused tool directly into the system prompt, and exposes a
 * `read_tool_docs(tool_id)` AI tool for on-demand loading in gallery mode.
 *
 * Required env (loaded from .env.local if present):
 *   - NOTION_API_KEY, NOTION_DB_RESOURCES (+ other catalog DB envs)
 *
 * Run with: npm run ingest-docs
 */

import fs from "node:fs";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { fetchAllResources, fetchAllTools } from "../src/lib/notion";

const OUTPUT_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "docs-text.json"
);

interface DocsText {
  generated_at: string;
  tools: Record<
    string,
    {
      tool_name: string;
      tool_slug: string;
      resources: Array<{
        resource_id: string;
        resource_title: string;
        text: string;
      }>;
    }
  >;
}

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

function isPdf(filename: string, mime?: string): boolean {
  if (mime && mime.toLowerCase().includes("pdf")) return true;
  return /\.pdf(\?|$)/i.test(filename);
}

async function extractPdfText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
  const buffer = new Uint8Array(await res.arrayBuffer());
  const pdf = await getDocumentProxy(buffer);
  const { text } = await extractText(pdf, { mergePages: true });
  const merged = Array.isArray(text) ? text.join("\n") : text;
  return merged.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function main(): Promise<void> {
  loadEnvLocal();

  if (!process.env.NOTION_API_KEY) {
    throw new Error("NOTION_API_KEY is required (set in .env.local).");
  }

  console.log("Fetching Notion tools and resources…");
  const [tools, resources] = await Promise.all([
    fetchAllTools(),
    fetchAllResources(),
  ]);
  console.log(
    `Found ${tools.length} tools and ${resources.length} resources.`
  );

  const toolMeta = new Map<string, { name: string; slug: string }>();
  for (const tool of tools) {
    toolMeta.set(tool.id, {
      name: tool.fields.name,
      slug: tool.id, // catalog uses tool.id as the slug
    });
  }

  const output: DocsText = {
    generated_at: new Date().toISOString(),
    tools: {},
  };

  let resourceIdx = 0;
  let failureCount = 0;
  let pdfCount = 0;

  for (const resource of resources) {
    resourceIdx++;
    const title = resource.fields.title || "Untitled resource";
    const toolIds = resource.fields.tool || [];
    const files = (resource.fields.files || []).filter((file) =>
      isPdf(file.filename, file.type)
    );

    if (resource.fields.published === false) {
      console.log(
        `  [${resourceIdx}/${resources.length}] skip (unpublished): ${title}`
      );
      continue;
    }
    if (!toolIds.length) {
      if (files.length) {
        console.log(
          `  [${resourceIdx}/${resources.length}] skip (no tool relation): ${title}`
        );
      }
      continue;
    }
    if (!files.length) continue;

    console.log(
      `  [${resourceIdx}/${resources.length}] ${title} — ${files.length} PDF(s) → ${toolIds.length} tool(s)`
    );

    for (const file of files) {
      try {
        const text = await extractPdfText(file.url);
        if (!text) {
          console.log(`      · ${file.filename}: no extractable text`);
          continue;
        }
        pdfCount++;

        for (const toolId of toolIds) {
          const meta = toolMeta.get(toolId);
          const bucket =
            output.tools[toolId] ||
            (output.tools[toolId] = {
              tool_name: meta?.name || "Unknown tool",
              tool_slug: meta?.slug || toolId,
              resources: [],
            });
          bucket.resources.push({
            resource_id: resource.id,
            resource_title: title,
            text,
          });
        }

        console.log(
          `      · ${file.filename}: ${text.length.toLocaleString()} chars extracted`
        );
      } catch (err) {
        failureCount++;
        console.warn(
          `      ! ${file.filename} failed: ${err instanceof Error ? err.message : err}`
        );
      }
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  const toolsWithDocs = Object.keys(output.tools).length;
  console.log(
    `\nWrote ${pdfCount} PDF(s) across ${toolsWithDocs} tool(s) to ${path.relative(process.cwd(), OUTPUT_PATH)}` +
      (failureCount ? ` (${failureCount} file failure(s))` : "")
  );
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
