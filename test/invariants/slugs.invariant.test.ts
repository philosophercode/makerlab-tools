import { fc, RUNS } from "./fc";
import { slugify, uniqueSlug } from "@/lib/db/slug";

/**
 * INVARIANT 19 — slugs are always safe URL segments, stable, and unique.
 *
 * Every tool and project URL is a slug made once from a name a person or a
 * model typed. For any name: the slug is non-empty, lower-case ASCII letters,
 * digits and single hyphens, at most 80 characters, with no hyphen at either
 * end; slugging it again changes nothing; and a batch of names given unique
 * slugs never collides.
 */

const SAFE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const name = fc.oneof(
  fc.string({ maxLength: 120 }),
  fc.string({ maxLength: 120, unit: "grapheme" }),
  fc.constantFrom("../../etc/passwd", "Café Crème", "Ｆｏｒｍ　４", "?id=1&x=<script>", "----", "", "🔥🔥", "a".repeat(200))
);

describe("invariant: slugs are safe, stable and unique", () => {
  it("is a safe URL segment of at most 80 characters", () => {
    fc.assert(
      fc.property(name, (n) => {
        const slug = slugify(n);
        expect(slug, n).toMatch(SAFE);
        expect(slug.length).toBeLessThanOrEqual(80);
      }),
      { numRuns: RUNS }
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(name, (n) => {
        expect(slugify(slugify(n))).toBe(slugify(n));
      }),
      { numRuns: RUNS }
    );
  });

  it("never collides within a batch", () => {
    fc.assert(
      fc.property(fc.array(name, { maxLength: 30 }), (names) => {
        const taken = new Set<string>();
        const slugs = names.map((n) => uniqueSlug(slugify(n), taken));
        expect(new Set(slugs).size).toBe(slugs.length);
        for (const s of slugs) expect(s).toMatch(SAFE);
      }),
      { numRuns: RUNS }
    );
  });
});
