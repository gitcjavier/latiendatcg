import { getStandardSets } from "../../lib/pokemontcg.js";
import { json, error } from "../../lib/respond.js";

export const prerender = false;

export async function GET() {
  try {
    const sets = await getStandardSets();
    return json({ total: sets.length, sets });
  } catch (err) {
    console.error("[/api/sets]", err.message);
    return error("Error al obtener ediciones.", 500, err.message);
  }
}
