import { z } from "zod";
import { LOCALE_CODES } from "../../i18n/config.ts";

/**
 * The lab config's schema (lab config spec 2026-10-25 §4, amendment §12):
 * every value that makes this deployment one particular lab's, checked in one
 * place. `lab/lab.config.ts` is typed by it (`defineLab`), `npm run lab:check`
 * and `next.config.ts` validate the file with it, and the tests pin the
 * shipped file against it.
 *
 * Not imported by the app at runtime: the app reads the file directly
 * (`config.ts`), so zod stays out of client bundles. Plain Node loads this
 * (`scripts/lab-check.ts`, `next.config.ts`), hence the relative `.ts`
 * imports and no `server-only`.
 */

const nonEmpty = z.string().trim().min(1, "must not be empty");

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a hex colour like #ff6b35");

/** A path under `public/`, as the browser asks for it. */
const publicPath = z.string().regex(/^\/[^\s]*$/, "must be a path under public/, starting with /");

const httpsUrl = z.url({ protocol: /^https?$/, error: "must be an http(s) URL" });

const email = z.email("must be an email address");

/** An IANA timezone the runtime's `Intl` knows. */
export function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const timezone = z.string().refine(isTimezone, "must be an IANA timezone Intl recognises, e.g. America/New_York");

const locale = z.enum(LOCALE_CODES as [string, ...string[]], "must be one of the supported locales (src/i18n/config.ts)");

/**
 * Text in the lab's own words (§12.1): one string for a lab that writes in one
 * language, or per-locale text with English required, which every locale it
 * does not give falls back to.
 */
export const localizedTextSchema = z.union([
  nonEmpty,
  z
    .object({ en: nonEmpty })
    .catchall(nonEmpty)
    .refine((value) => Object.keys(value).every((key) => LOCALE_CODES.includes(key)), "has a key that is not a supported locale"),
]);

export type LocalizedText = string | ({ en: string } & { [locale: string]: string });

const labLink = z.strictObject({ href: httpsUrl, label: localizedTextSchema });

export const labConfigSchema = z
  .strictObject({
    identity: z.strictObject({
      /** The site's name: headers, titles, the PDF's creator. */
      siteName: nonEmpty,
      /** The lab's own name, as people say it: "MakerLAB". */
      labName: nonEmpty,
      institution: nonEmpty,
      tagline: nonEmpty,
      assistantName: nonEmpty,
      /** Who the assistant talks to, in the chat system prompt (server-only). */
      audience: nonEmpty,
    }),
    brand: z.strictObject({
      logo: publicPath,
      wordmark: publicPath,
      colors: z.strictObject({ primary: hexColor, primaryDark: hexColor }),
    }),
    web: z.strictObject({
      siteUrl: httpsUrl,
      sourceUrl: httpsUrl,
    }),
    place: z.strictObject({
      timezone,
      /** One line for the header strip and the kiosk. */
      hours: nonEmpty,
    }),
    access: z.strictObject({
      /**
       * The sign-in boundary: an address on this domain may become an account.
       * Individual addresses (`AUTH_ALLOWED_EMAILS`, `AUTH_SUPER_ADMIN_EMAILS`)
       * stay in env, never in this committed file (§12.3).
       */
      emailDomain: z
        .string()
        .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "must be a domain like cornell.edu, without @"),
    }),
    email: z.strictObject({
      /** Notifications' sender, `Name <address>` or an address; null leaves mail off unless `EMAIL_FROM` is set. */
      from: nonEmpty.nullable(),
      replyTo: email.nullable(),
    }),
    contact: z.strictObject({
      /** The demo pass thank-you's address; null points to About's contacts. */
      demoEmail: email.nullable(),
    }),
    locale: z.strictObject({ default: locale }),
    people: z.array(
      z.strictObject({
        name: nonEmpty,
        /** As written, in every locale (§11 Q2). */
        title: nonEmpty,
        /** Only an address the lab publishes itself. */
        email: email.optional(),
      })
    ),
    links: z.strictObject({
      /** The lab's official page: the authority for hours and access. */
      official: labLink.optional(),
      /** More "Learn more" links, in order. */
      more: z.array(labLink),
    }),
    photos: z.array(
      z.strictObject({
        src: publicPath,
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        alt: localizedTextSchema,
        caption: localizedTextSchema.optional(),
      })
    ),
    about: z.strictObject({
      title: localizedTextSchema,
      lede: localizedTextSchema,
      /** Paragraphs about the lab, in order. */
      body: z.array(localizedTextSchema).min(1),
      where: localizedTextSchema,
      hours: localizedTextSchema,
      hoursNote: localizedTextSchema.optional(),
      community: localizedTextSchema.optional(),
      thanks: localizedTextSchema.optional(),
    }),
    assistant: z.strictObject({
      /** Markdown: the lab, its building, people, hours and institution. Static per deploy (cacheable prefix). */
      aboutLab: nonEmpty,
      /** Whom the assistant suggests asking: "SuperMaker". */
      helperTitle: nonEmpty,
    }),
    pages: z.strictObject({ product: z.boolean() }),
    /** True when `lab/floor-plan.json` is this lab's map; false hides every map feature. */
    map: z.boolean(),
  });

export type LabConfig = z.infer<typeof labConfigSchema>;

/** Field names that look like they hold a secret. The schema has none; a fork adding one is told to use env. */
const SECRET_SHAPE = /(secret|token|password|api[_-]?key|private[_-]?key)/i;

/**
 * Every problem with a config, one line each, with the field's path — empty
 * when it is valid. What `lab:check` prints and what `next.config.ts` throws.
 */
export function labConfigIssues(config: unknown): string[] {
  const issues: string[] = [];
  for (const path of secretLookingKeys(config)) {
    issues.push(`${path}: looks like a secret. Keys and tokens belong in environment variables, never in lab.config.ts`);
  }
  const parsed = labConfigSchema.safeParse(config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push(`${issue.path.length > 0 ? issue.path.join(".") : "(config)"}: ${issue.message}`);
    }
  }
  return issues;
}

function secretLookingKeys(value: unknown, path: string[] = []): string[] {
  if (typeof value !== "object" || value === null) return [];
  const found: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const here = [...path, key];
    if (SECRET_SHAPE.test(key)) found.push(here.join("."));
    found.push(...secretLookingKeys(child, here));
  }
  return found;
}
