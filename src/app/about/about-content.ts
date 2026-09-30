/**
 * The About page's facts that are not prose (identity spec 2026-09-28 §6):
 * the lab's people and the pages it links to. Names and addresses are not
 * translated, so they live here rather than in the message catalogs.
 *
 * Sources: https://tech.cornell.edu/research/makerlab/ (contacts, the
 * official page), https://tech.cornell.edu/people/niti-parikh/ (Niti's
 * title). Luis Rodrigo Navarro's name and title "Assistant Director" are the
 * owner's; the public page lists "Luis Navarro, MakerLAB Manager".
 */
export const ABOUT_PEOPLE = [
  { name: "Niti Parikh", roleKey: "nitiRole", email: "ntp27@cornell.edu" },
  { name: "Luis Rodrigo Navarro", roleKey: "luisRole", email: "ln328@cornell.edu" },
] as const;

export const ABOUT_LINKS = {
  official: "https://tech.cornell.edu/research/makerlab/",
  youtube: "https://www.youtube.com/playlist?list=PL4EfVJKkC-nrCuEUS1wmk0L6jhteO2Do6",
  instagram: "https://www.instagram.com/cornelltechmakerlab/",
} as const;
