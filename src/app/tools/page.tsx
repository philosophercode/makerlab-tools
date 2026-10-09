/**
 * `/tools` was the full list from the first student home build until the
 * list became the home page again (student home spec 2026-10-07, amendment
 * "One page: the list at rest"). `next.config.ts` redirects `/tools` to `/`,
 * query and all, before this file is reached; should that redirect ever go,
 * the address still shows the same page rather than a 404. Tool pages are
 * `/tools/[id]`.
 */
export { default } from "../page";
