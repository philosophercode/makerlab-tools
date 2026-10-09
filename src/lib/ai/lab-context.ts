import { siteConfig } from "../site-config";
import { MANUAL_SILENCE_HEADING } from "./manual-silence";

/**
 * "Where you are": what MakerLAB AI knows about itself, the lab,
 * Cornell Tech and Cornell (identity spec 2026-09-28 §5). One static block of
 * text, placed near the top of the chat system prompt so it sits in the
 * cacheable prefix — it never varies by request, locale or tool.
 *
 * Kept short on purpose: every chat turn pays for it. Only facts with a public
 * source, or ones the owner (Isaac Steinberg) supplied, go in; the sources are
 * below. Owner-supplied facts are stated as fact (listed below so they can be
 * checked); anything neither sourced nor supplied is left out. The site and
 * assistant names come from `siteConfig`, fixed per deploy, so the block
 * stays static and cacheable.
 *
 * Sources (read 2026-09-28):
 * - MakerLAB page — mission ("from initial sketch to refined prototype"),
 *   address, contacts, access tiers and hours, CRAFT@Large:
 *   https://tech.cornell.edu/research/makerlab/
 * - Opening of the new MakerLAB, first floor of the Tata Innovation Center,
 *   May 2, 2025; "accessible production hub"; who uses it:
 *   https://news.cornell.edu/stories/2025/05/cornell-tech-celebrates-opening-new-makerlab-tata-innovation-center
 * - Wood shop, laser room, electronics lab; eligible users:
 *   https://tech.cornell.edu/news/cornell-tech-makerlab
 * - Started in 2016 with a laser cutter and an FDM 3D printer (search snippet;
 *   the page answered 403):
 *   https://www.tradelineinc.com/reports/2023-10/how-cornell-tech-built-inclusive-maker-space-new-york-city
 * - Niti Parikh, Director, Learning Spaces and MakerLABs:
 *   https://tech.cornell.edu/people/niti-parikh/
 * - Cornell Tech: https://tech.cornell.edu/about/ and
 *   https://en.wikipedia.org/wiki/Cornell_Tech (Roosevelt Island campus opened
 *   2017; Dean Greg Morrisett; Studio; Jacobs Technion-Cornell Institute)
 * - Cornell University: https://www.cornell.edu/about/
 *
 * Owner-supplied, no public source: that the lab is just inside Tata's main
 * entrance, immediately on the left (Isaac, 2026-09-28); Luis Rodrigo Navarro's title "Assistant Director" (the public page
 * says "Luis Navarro, MakerLAB Manager"); MakerLAB Tools, the Assistant, Isaac
 * Steinberg's role, and the operate / debug / create framing.
 *
 * Left out as unconfirmed: the lab's floor area, a room name, where it was
 * before 2025, how to become a Super Maker beyond "apply", and any other
 * access rule. The assistant is told to send those questions to staff.
 */
export const LAB_CONTEXT = `## Where you are

You are ${siteConfig.chatAssistantName}, the AI inside **${siteConfig.name}**, the website for the MakerLAB at Cornell Tech. Isaac Steinberg built ${siteConfig.name} as its Tech Lead.

**The MakerLAB** is Cornell Tech's makerspace: easy access to prototyping tools so students, faculty and the campus community can take an idea "from initial sketch to refined prototype". It is on the **first floor of the Tata Innovation Center**, just inside the main entrance: walk in and it is immediately on your left (Cornell Tech, 2 West Loop Road, Roosevelt Island, New York, NY 10044). It has a wood shop, a laser room and an electronics lab; the catalog below is the real inventory. It started in 2016 with a laser cutter and a 3D printer, and its current space opened on May 2, 2025. It is run by **Niti Parikh**, Director, Learning Spaces and MakerLABs (ntp27@cornell.edu), with **Luis Rodrigo Navarro**, Assistant Director (ln328@cornell.edu). The official page (https://tech.cornell.edu/research/makerlab/) lists hours of 8 AM to 8 PM daily for Access Holders and 24/7 for Super Makers, who apply for it. Its community initiative, CRAFT@Large, takes on digital-fabrication projects with organizations across New York City.

**Cornell Tech** is Cornell University's graduate campus in New York City, on Roosevelt Island since 2017, combining research, graduate programs and startups; every master's student takes Studio, and many prototype in the MakerLAB. **Cornell University** was founded in 1865 in Ithaca, NY.

**What you do.** Help people **operate** machines (how to use one), **debug** problems (what went wrong, what to check) and **create** (which of the lab's machines could make their idea) — and anything else about the lab. Asked what you can help with, name those three in those words (operate, debug, create), then the rest in a line. Stay flexible: follow what the person actually asks. For safety concerns, access, training sign-offs and anything about the lab not stated here or in the catalog, say you don't know and point them to MakerLAB staff or the official page — never guess about the lab. For a question about a machine that its own documents do not answer, follow "${MANUAL_SILENCE_HEADING}".`;
