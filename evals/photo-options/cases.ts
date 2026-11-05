/**
 * The photo-quality eval's tools (photo options spec 2026-10-29, amendment
 * "A photo-quality eval"). Real catalogue machines from the Cornell Tech lab,
 * spread across the categories, each with the maker's own sites: a top pick
 * on one of these is "the maker's photo".
 *
 * `links` is empty on purpose. The tools that need better photos are mostly
 * the ones nobody added a product page to, so the eval measures the search on
 * the name alone, the hard case. `model` is what the judge is told the picture
 * must show, close enough to tell it from the maker's other models.
 */

export interface PhotoEvalCase {
  /** The catalogue's display name, as the editor's search sends it. */
  name: string;
  /** What the picture must show, for the judge. */
  model: string;
  /** The maker's own hosts (and their subdomains). */
  makerHosts: readonly string[];
  links: readonly string[];
}

export const PHOTO_EVAL_CASES: readonly PhotoEvalCase[] = [
  {
    name: "Bambu Lab X1-Carbon Combo 3D Printer",
    model: "Bambu Lab X1-Carbon 3D printer (the Combo comes with an AMS filament unit on top)",
    makerHosts: ["bambulab.com"],
    links: [],
  },
  {
    name: "Formlabs Form 4",
    model: "Formlabs Form 4 resin 3D printer",
    makerHosts: ["formlabs.com"],
    links: [],
  },
  {
    name: "Prusa i3 MK3S+",
    model: "Original Prusa i3 MK3S+ FDM 3D printer (orange and black frame)",
    makerHosts: ["prusa3d.com"],
    links: [],
  },
  {
    name: "Ultimaker S5",
    model: "Ultimaker S5 dual-extrusion 3D printer",
    makerHosts: ["ultimaker.com"],
    links: [],
  },
  {
    name: "Epilog Helix 24 Laser Cutter",
    model: "Epilog Helix 24 laser engraver (Model 8000)",
    makerHosts: ["epiloglaser.com"],
    links: [],
  },
  {
    name: "Trotec Speedy 400",
    model: "Trotec Speedy 400 CO2 laser engraver",
    makerHosts: ["troteclaser.com"],
    links: [],
  },
  {
    name: "Shaper Origin",
    model: "Shaper Origin handheld CNC router",
    makerHosts: ["shapertools.com"],
    links: [],
  },
  {
    name: "Cricut Maker 3",
    model: "Cricut Maker 3 cutting machine",
    makerHosts: ["cricut.com"],
    links: [],
  },
  {
    name: "Hakko Soldering Station",
    model: "Hakko FX-888D digital soldering station",
    makerHosts: ["hakko.com", "hakkousa.com"],
    links: [],
  },
  {
    name: "DeWalt Drill/Driver",
    model: "DeWalt DCD777 20V MAX brushless compact drill/driver",
    makerHosts: ["dewalt.com"],
    links: [],
  },
  {
    name: "Festool TS 55 Track Saw",
    model: "Festool TS 55 plunge-cut track saw",
    makerHosts: ["festool.com", "festoolusa.com"],
    links: [],
  },
  {
    name: "Roland Camm-1 GS-24 Desktop Vinyl Cutter",
    model: "Roland CAMM-1 GS-24 desktop vinyl cutter",
    makerHosts: ["rolanddga.com", "rolanddg.com"],
    links: [],
  },
];
