import type { UserRecord } from "../data/users";

/**
 * Twenty made-up people for the People page while the demo identity is
 * looking (demo admin spec 2026-10-11 §7): fifteen `user`s and five `admin`s,
 * so a lab with a handful of real accounts still shows what the roster is
 * like. Never a super admin — the real directors stay the only ones.
 *
 * **Generated here, never written anywhere.** Not a seed, not a migration, not
 * a row: `/admin/users` appends them to what it read only for the demo
 * identity, marks each one **Sample**, and renders the whole roster read-only
 * for that viewer. A real signed-in person, or any viewer with `DEMO_ADMIN`
 * off, never sees them. Addresses are on `example.edu` (RFC 2606's reserved
 * `example` names), and are masked like every other address the demo sees.
 */

/** Every sample id starts with this, so nothing can mistake one for a real row. */
export const SAMPLE_PERSON_PREFIX = "sample-";

const USERS: ReadonlyArray<readonly [string, string]> = [
  ["Maya Chen", "mchen"],
  ["Jordan Alvarez", "jalvarez"],
  ["Priya Natarajan", "pnatarajan"],
  ["Samuel Okafor", "sokafor"],
  ["Elena Petrova", "epetrova"],
  ["Lucas Moreau", "lmoreau"],
  ["Aisha Rahman", "arahman"],
  ["Daniel Kim", "dkim"],
  ["Sofia Rossi", "srossi"],
  ["Noah Goldberg", "ngoldberg"],
  ["Hana Suzuki", "hsuzuki"],
  ["Mateo Fernández", "mfernandez"],
  ["Grace Liu", "gliu"],
  ["Omar Haddad", "ohaddad"],
  ["Chloe Williams", "cwilliams"],
];

const ADMINS: ReadonlyArray<readonly [string, string]> = [
  ["Ravi Shah", "rshah"],
  ["Isabel Duarte", "iduarte"],
  ["Theo Bergström", "tbergstrom"],
  ["Nia Johnson", "njohnson"],
  ["Kenji Watanabe", "kwatanabe"],
];

/** A fixed first sign-in per person, so the roster is the same on every load. */
function joined(index: number): Date {
  return new Date(Date.UTC(2026, 7, 25 + index, 15, 0, 0));
}

function person(name: string, handle: string, role: "user" | "admin", index: number): UserRecord {
  return {
    id: `${SAMPLE_PERSON_PREFIX}${handle}`,
    email: `${handle}@example.edu`,
    name,
    role,
    banned: false,
    banReason: null,
    title: null,
    // Two of the students were added ahead of time and have not signed in.
    firstSignedInAt: role === "user" && index % 7 === 6 ? null : joined(index),
    createdAt: joined(index),
  };
}

/** The twenty sample people, admins first. */
export function samplePeople(): UserRecord[] {
  return [
    ...ADMINS.map(([name, handle], index) => person(name, handle, "admin", index)),
    ...USERS.map(([name, handle], index) => person(name, handle, "user", index + ADMINS.length)),
  ];
}

/** True for a sample person's id. */
export function isSamplePerson(id: string): boolean {
  return id.startsWith(SAMPLE_PERSON_PREFIX);
}
