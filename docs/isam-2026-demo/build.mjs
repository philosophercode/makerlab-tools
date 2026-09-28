#!/usr/bin/env node
// Build the ISAM 2026 demo abstract from Markdown.
//
//   node docs/isam-2026-demo/build.mjs [abstract-v2.md]
//
// Reads the Markdown (default abstract-v2.md next to this script), fills
// abstract-template.html (the ISAM print CSS), writes abstract-v2.html, then
// prints the PDF named in the front matter's `pdf:` with headless Chrome and
// reports the abstract's word count and the PDF's page count.
//
// No dependencies: a small converter for the Markdown subset the paper uses.
//   Front matter   --- title / venue / authors / affiliations (list) / pdf ---
//   Headings       ## Section   ### Subsection   (## Abstract, ## Acknowledgements
//                  and ## References get the template's special styles)
//   Paragraphs     blank-line separated; **bold**, *italic*, [text](url), ^1^ superscript;
//                  straight quotes are typeset as curly ones
//   Lists          lines starting "- "
//   Figures        ![Fig. 1: caption](file.png "width=2.4in")  — caption below the image.
//                  "wide" in the title spans both columns under the author block.
//   Comments       <!-- … --> are dropped (use them for notes to co-authors)
//
// Env: CHROME overrides the Chrome binary path.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcPath = resolve(process.argv[2] ?? join(here, "abstract-v2.md"));
const dir = dirname(srcPath);
const htmlPath = join(dir, basename(srcPath).replace(/\.md$/, ".html"));
const template = readFileSync(join(here, "abstract-template.html"), "utf8");

// ---------- parse ----------
let md = readFileSync(srcPath, "utf8").replace(/\r\n/g, "\n");
md = md.replace(/<!--[\s\S]*?-->/g, ""); // drop comments

const fm = {};
const fmMatch = md.match(/^\s*---\n([\s\S]*?)\n---\n/);
if (!fmMatch) throw new Error("abstract: missing front matter (--- … ---) at the top");
md = md.slice(fmMatch[0].length);
let listKey = null;
for (const line of fmMatch[1].split("\n")) {
  const item = line.match(/^\s+-\s+(.*)$/);
  if (item && listKey) { fm[listKey].push(item[1]); continue; }
  const kv = line.match(/^(\w+):\s*(.*)$/);
  if (!kv) continue;
  if (kv[2] === "") { listKey = kv[1]; fm[listKey] = []; }
  else { listKey = null; fm[kv[1]] = kv[2]; }
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Straight quotes in the source become typographic ones (URLs have none).
const smart = (s) => s
  .replace(/(^|[\s(\[—–-])"/g, "$1“").replace(/"/g, "”")
  .replace(/'(?=\d)/g, "\u2019")
  .replace(/(^|[\s(\[—–-])'/g, "$1‘").replace(/'/g, "’");
function inline(s) {
  let out = esc(smart(s));
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<i>$2</i>");
  out = out.replace(/\^([^^\s]+)\^/g, "<sup>$1</sup>");
  return out;
}

function figure(line) {
  const m = line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/);
  if (!m) return null;
  const [, caption, src, opts = ""] = m;
  if (!existsSync(join(dir, src))) throw new Error(`figure not found: ${src}`);
  const wide = /\bwide\b/.test(opts);
  const width = opts.match(/width=([\d.]+(?:in|pt|%))/)?.[1];
  const style = width ? ` style="width:${width}"` : "";
  const alt = esc(caption.replace(/^Fig\.\s*\d+:\s*/, ""));
  return { wide, html: `<figure><img src="${src}" alt="${alt}"${style}><figcaption>${inline(caption)}</figcaption></figure>` };
}

const blocks = md.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
const body = [];
const wideFigures = [];
let section = null; // "abstract" | "ack" | "refs" | null
let open = null;
let abstractText = "";
const closeWrap = () => { if (open) { body.push("</div>"); open = null; } };

for (const block of blocks) {
  const h = block.match(/^(#{2,3})\s+(.*)$/);
  if (h && !block.includes("\n")) {
    const level = h[1].length;
    const text = h[2].trim();
    if (level === 2) {
      closeWrap();
      section = /^abstract$/i.test(text) ? "abstract" : /^acknowledg/i.test(text) ? "ack" : /^references$/i.test(text) ? "refs" : null;
      if (section === "abstract") continue; // the label is inline
      body.push(`<h2>${inline(text)}</h2>`);
      if (section) { body.push(`<div class="${section}">`); open = section; }
    } else body.push(`<h3>${inline(text)}</h3>`);
    continue;
  }
  const fig = figure(block);
  if (fig) { (fig.wide ? wideFigures : body).push(fig.html); continue; }
  if (/^- /.test(block)) {
    const items = block.split(/\n(?=- )/).map((i) => `<li>${inline(i.replace(/^- /, "").replace(/\n\s*/g, " "))}</li>`);
    body.push(`<ul>${items.join("")}</ul>`);
    continue;
  }
  const text = block.replace(/\n\s*/g, " ");
  if (section === "abstract") {
    abstractText += " " + text;
    body.push(`<p><span class="abstract-label">Abstract&mdash;</span>${inline(text)}</p>`);
    section = null;
    continue;
  }
  body.push(`<p>${inline(text)}</p>`);
}
closeWrap();

const header = [
  fm.venue ? `<p class="venue">${inline(fm.venue)}</p>` : "",
  `<h1 class="title">${inline(fm.title)}</h1>`,
  `<p class="authors">${inline(fm.authors)}</p>`,
  ...(fm.affiliations ?? []).map((a) => `<p class="affil">${inline(a)}</p>`),
  ...wideFigures,
].filter(Boolean).join("\n");

const html = template
  .replace("{{TITLE_TEXT}}", esc(fm.title.replace(/\^[^^]*\^/g, "")))
  .replace("{{HEADER}}", header)
  .replace("{{BODY}}", body.join("\n"));
writeFileSync(htmlPath, html);

// ---------- print ----------
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pdfPath = join(dir, fm.pdf ?? basename(srcPath).replace(/\.md$/, ".pdf"));
execFileSync(chrome, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`], { stdio: "ignore" });

// ---------- checks ----------
const words = abstractText.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const pdf = readFileSync(pdfPath).toString("latin1");
const pages = (pdf.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
console.log(`wrote ${htmlPath}`);
console.log(`wrote ${pdfPath}`);
console.log(`abstract: ${words} words (limit 300)${words > 300 ? "  <-- OVER" : ""}`);
console.log(`pages: ${pages || "unknown (check with mdls -name kMDItemNumberOfPages)"}${pages && pages !== 2 ? "  <-- ISAM demo abstracts are 1–2 pages; this one should be exactly 2" : ""}`);
if (words > 300 || (pages && pages > 2)) process.exitCode = 1;
