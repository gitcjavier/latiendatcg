import { getCardsBySet } from "../../../../lib/pokemontcg.js";
import { json, error } from "../../../../lib/respond.js";

export const prerender = false;

export async function GET({ params, url }) {
  const id = params.id;
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  try {
    const data = await getCardsBySet(id, page);
    return json(data);
  } catch (err) {
    console.error("[/api/sets/:id/cards]", err.message);
    return error("Error al obtener cartas de la edición.", 500, err.message);
  }
}
