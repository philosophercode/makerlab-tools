/**
 * The ideal-lab eval's golden set: ten machines from the demo lab's list
 * (`/mnt/project-files/demo-lab/ideal-lab-tools.csv`, the ten chosen for the
 * demo's research), each added the way a person adds one in the chat — a
 * vague, half-remembered message — and three **held out**: never looked at
 * while prompts are tuned, so a change that only fits the ten shows up as a
 * gap between the two groups.
 *
 * `model` is the truth the judges grade against. `mustName` are the tokens the
 * identified name has to carry (case and spacing ignored) — the model number
 * that tells it from its siblings. `makerHosts` are the manufacturer's own
 * sites, for "is the cover the maker's photo".
 */

export interface IdealLabCase {
  id: string;
  /** What the person types in the chat. Deliberately fuzzy. */
  prompt: string;
  /** The exact machine, for the judges. */
  model: string;
  brand: string;
  mustName: string[];
  makerHosts: string[];
  /**
   * The map zone the approval draft should start in (one of {@link LAB_ZONES}),
   * from where the prompt says it lives; null when the prompt doesn't say.
   */
  zone: string | null;
  /** Not tuned against; reported separately. */
  holdout?: boolean;
}

/**
 * The real lab's map zones (the demo lab shares them: `demo-lab/demo-zones.sql`),
 * as the approval draft's location options. Ids are stand-ins: nothing is stored.
 */
export const LAB_ZONES = [
  { id: "zone-common", room: "Studio 101", zone: "Common Purpose Space", mapTag: null },
  { id: "zone-3dp", room: "Studio 101", zone: "3D Printing Hub", mapTag: null },
  { id: "zone-machining", room: "Studio 101A", zone: "Machining Shop", mapTag: null },
  { id: "zone-laser", room: "Studio 101C", zone: "Laser Machine Room", mapTag: null },
  { id: "zone-electronics", room: "Studio 101D", zone: "Electronics Lab", mapTag: null },
] as const;

export const IDEAL_LAB_CASES: IdealLabCase[] = [
  {
    id: "bambu-h2d",
    zone: "3D Printing Hub",
    prompt: "we just got 4 of the new big bambu printers, the dual nozzle one that can take the laser module. H2-something? they go in the 3d printing area",
    model: "Bambu Lab H2D",
    brand: "Bambu Lab",
    mustName: ["H2D"],
    makerHosts: ["bambulab.com"],
  },
  {
    id: "formlabs-form-4",
    zone: "3D Printing Hub",
    prompt: "add the formlabs resin printer, the newest one (form 4 i think). 3 of them, by the other printers",
    model: "Formlabs Form 4",
    brand: "Formlabs",
    mustName: ["Form 4"],
    makerHosts: ["formlabs.com"],
  },
  {
    id: "trotec-speedy-400",
    zone: "Laser Machine Room",
    prompt: "2x trotec speedy 400 laser cutters for the laser room",
    model: "Trotec Speedy 400",
    brand: "Trotec",
    mustName: ["Speedy 400"],
    makerHosts: ["troteclaser.com", "trotec.com"],
  },
  {
    id: "glowforge-pro",
    zone: null,
    prompt: "glowforge pro",
    model: "Glowforge Pro",
    brand: "Glowforge",
    mustName: ["Glowforge", "Pro"],
    makerHosts: ["glowforge.com"],
  },
  {
    id: "shaper-origin",
    zone: "Machining Shop",
    prompt: "can you add the handheld cnc router from shaper? we have two in the machine shop",
    model: "Shaper Origin",
    brand: "Shaper Tools",
    mustName: ["Origin"],
    makerHosts: ["shapertools.com"],
  },
  {
    id: "bantam-pcb-mill",
    zone: "Electronics Lab",
    prompt: "bantam tools desktop pcb mill, 2 of them in electronics",
    model: "Bantam Tools Desktop PCB Milling Machine",
    brand: "Bantam Tools",
    mustName: ["Bantam", "PCB"],
    makerHosts: ["bantamtools.com"],
  },
  {
    id: "sawstop-pcs",
    zone: "Machining Shop",
    prompt: "new table saw for the shop: sawstop professional cabinet saw, the 3hp one",
    model: "SawStop Professional Cabinet Saw (PCS)",
    brand: "SawStop",
    mustName: ["SawStop", "Professional"],
    makerHosts: ["sawstop.com"],
  },
  {
    id: "hakko-fx-888dx",
    zone: "Electronics Lab",
    prompt: "10 hakko 888 soldering irons for the electronics bench",
    model: "Hakko FX-888DX Soldering Station",
    brand: "Hakko",
    mustName: ["FX-888DX"],
    makerHosts: ["hakko.com", "hakkousa.com"],
  },
  {
    id: "revopoint-miraco-pro",
    zone: "Common Purpose Space",
    prompt: "revopoint miraco pro handheld 3d scanner, 2, keep them in the common space",
    model: "Revopoint MIRACO Pro 3D Scanner",
    brand: "Revopoint",
    mustName: ["MIRACO", "Pro"],
    makerHosts: ["revopoint3d.com"],
  },
  {
    id: "ur5e",
    zone: "Electronics Lab",
    prompt: "UR5e cobot arm, it lives in the electronics lab",
    model: "Universal Robots UR5e",
    brand: "Universal Robots",
    mustName: ["UR5e"],
    makerHosts: ["universal-robots.com"],
  },
  // ── Held out: never tuned against ───────────────────────────────
  {
    id: "prusa-core-one",
    zone: null,
    prompt: "4 prusa core ones",
    model: "Prusa Core One",
    brand: "Prusa Research",
    mustName: ["Core One"],
    makerHosts: ["prusa3d.com"],
    holdout: true,
  },
  {
    id: "rigol-ds1054z",
    zone: "Electronics Lab",
    prompt: "four rigol 1054z scopes for electronics",
    model: "Rigol DS1054Z Oscilloscope",
    brand: "Rigol",
    mustName: ["DS1054Z"],
    makerHosts: ["rigol.com", "rigolna.com"],
    holdout: true,
  },
  {
    id: "festool-domino-500",
    zone: null,
    prompt: "festool domino joiner, the smaller 500 one",
    model: "Festool Domino DF 500",
    brand: "Festool",
    mustName: ["DF 500"],
    makerHosts: ["festool.com", "festoolusa.com"],
    holdout: true,
  },
];

/** "fx 888dx" and "FX-888DX" are the same token: letters and digits only, lower case. */
export function nameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** True when the identified name carries every one of the case's tokens. */
export function namesTheModel(name: string, testCase: Pick<IdealLabCase, "mustName">): boolean {
  const key = nameKey(name);
  return testCase.mustName.every((token) => key.includes(nameKey(token)));
}
