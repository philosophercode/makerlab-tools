// `node --experimental-strip-types scripts/mp4-captions-off.ts <file.mp4>`
//
// ffmpeg's MP4 muxer always marks the first track of each kind "enabled",
// which some players (QuickTime, Safari) treat as captions-on. This clears the
// enabled flag in the tkhd of every subtitle/text track, in place, so the
// closed captions stay available but start off.
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("usage: mp4-captions-off.ts <file.mp4>");
const buf = readFileSync(file);

type Box = { type: string; start: number; size: number; body: number };
function boxes(from: number, to: number): Box[] {
  const out: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    let body = p + 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(p + 8));
      body = p + 16;
    } else if (size === 0) size = to - p;
    out.push({ type, start: p, size, body });
    p += size;
  }
  return out;
}
const child = (b: Box, type: string) => boxes(b.body, b.start + b.size).find((x) => x.type === type);

const moov = boxes(0, buf.length).find((b) => b.type === "moov");
if (!moov) throw new Error("no moov box");
let changed = 0;
for (const trak of boxes(moov.body, moov.start + moov.size).filter((b) => b.type === "trak")) {
  const hdlr = child(child(trak, "mdia")!, "hdlr")!;
  const handler = buf.toString("latin1", hdlr.body + 8, hdlr.body + 12); // version/flags(4) + pre_defined(4)
  if (handler !== "sbtl" && handler !== "text") continue;
  const tkhd = child(trak, "tkhd")!;
  const flagsLow = tkhd.body + 3; // version(1) + flags(3): enabled is bit 0 of the last byte
  buf[flagsLow] &= ~0x1;
  changed++;
}
writeFileSync(file, buf);
console.log(`captions track(s) set to off: ${changed}`);
