import { searchCardsByName } from "../../lib/pokemontcg.js";
import { json, error } from "../../lib/respond.js";

export const prerender = false;

export async function GET({ url }) {
  const name = url.searchParams.get("name")?.trim() ?? "";
  if (!name || name.length < 2) {
    return error("Nombre de carta requerido (mínimo 2 caracteres).", 400);
  }
  try {
    const data = await searchCardsByName(name);
    return json(data);
  } catch (err) {
    console.error("[/api/cards]", err.message);
    return error("Error al buscar cartas.", 500, err.message);
  }
}
