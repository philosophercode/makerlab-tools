import { DISPLAY_NAME_MAX, DISPLAY_NAME_TARGET } from "./tool-names.ts";

/**
 * The display-name rules as a model is told them — **one text**, shared by
 * the display-name backfill, research's read step and bulk intake's Suggest
 * names (display names amendment 2026-09-25), so the three cannot drift.
 *
 * Code still has the last word: `cleanDisplayName` removes part numbers,
 * `isBareBrand` refuses a name that is only a brand, and the callers refuse a
 * name another tool already has. This text is what makes the model's answer
 * rarely need them. The examples are the owner's, from a dry run on the real
 * inventory.
 *
 * Plain Node, relative imports: `scripts/` and workflow steps import it.
 */
export const DISPLAY_NAME_RULES = [
  `The **display name** is the short name people in the lab would say, shown on gallery cards, chat chips and labels. It must always say **what the item is**.`,
  `- Usually the brand plus what it is: "Makita 196094-2 Compact Router Plunge Base" → "Makita Plunge Base"; "DRILL MASTER 1500 Watt Dual-Temperature Heat Gun (Model 96289)" → "Drill Master Heat Gun"; "STANLEY 20-221 10-Inch SharpTooth Mini Utility Saw" → "Stanley Mini Utility Saw"; "WEN Woodworking Dust Collector (DC3401)" → "WEN Dust Collector"; "Bofa AD500 Fume Extractor" → "Bofa Fume Extractor".`,
  `- Keep the model name when it **is** the name people say for that product: "Dremel 3000", "Formlabs Form 4", "Bambu Lab X2D", "Trotec Speedy 400", "Othermill Pro", "Rockwell BladeRunner X2", "EverSewn Sparrow X2", "ShopBot Buddy BT48", "HP Sprout". A catalogue or part code is not such a name — "RT0701C", "WESD51", "FX-888D", "2703A", "196094-2", "DCB107", "575267" — so say what the item is instead: "MAKITA RT0701C" (a compact router) → "Makita Compact Router"; "Weller WESD51" and "HAKKO FX-888D" (soldering stations) → "Weller Soldering Station", "Hakko Soldering Station"; "AOYUE Int 2703A+" (a rework station) → "Aoyue Rework Station".`,
  `- **Never the brand alone**, and never the brand plus a fragment or company word: not "Hakko", "Makita", "Weller", "Aoyue Int", "Bambu Lab". When the name is only a brand and a code, take what the item is from its category or description.`,
  `- **No part or catalogue numbers**, and no sizes, voltages, wattages, capacities or piece counts, and nothing in brackets — **except** the one attribute (capacity, size, power or generation) that tells two of the lab's tools apart when they would otherwise have the same name: "RYOBI ONE+ 18V Lithium-Ion 1.5 Ah Battery PBP002", "… 4 Ah Battery PBP004" → "Ryobi ONE+ 1.5Ah Battery", "Ryobi ONE+ 4Ah Battery"; "iPad 6th generation".`,
  `- About ${DISPLAY_NAME_TARGET} characters, never more than ${DISPLAY_NAME_MAX}. The brand in its ordinary capitalisation ("Stanley", not "STANLEY"; "Spear & Jackson Tenon Saw"). Never add a model, size or feature that neither the name nor what you are given says.`,
].join("\n");
