import type { ResearchItemInput } from "../research/prompt.ts";

/**
 * The only thing refresh research is told about a tool (refresh research spec
 * §2 "Blind research", §3.1): its **name** and its **category's name** as a
 * hint. Nothing else a record holds — description, specs, materials, PPE,
 * tags, restrictions, the emergency stop, notes — can reach a prompt, because
 * {@link ResearchItemInput} has no field for any of it, and this builds one
 * from a picked subset of the tool so a whole record passed in by mistake
 * still sends only these.
 *
 * - **Brand** is not a tool column. Research's search settles the make from
 *   the name, as it does for intake; it is left null (§3.1, open question 3).
 * - **Location** is left out: it is a floor fact, and the spec's blind inputs
 *   are name, brand and category only.
 *
 * Pure. Plain Node.
 */
export function blindInput(tool: { name: string; categoryName: string | null }): ResearchItemInput {
  return {
    name: tool.name,
    brand: null,
    categoryHint: tool.categoryName,
    locationHint: null,
  };
}
