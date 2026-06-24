import { searchPreventas } from "../../lib/preventas.js";
import { json, error } from "../../lib/respond.js";

export const prerender = false;

export async function GET({ url }) {
  const term = (url.searchParams.get("q") ?? "").trim();
  const edition = (url.searchParams.get("edition") ?? "").trim();
  const types = (url.searchParams.get("types") ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const onlyInStock = url.searchParams.get("stock") === "1";
  const sort = url.searchParams.get("sort") === "desc" ? "desc" : "asc";
  try {
    const data = await searchPreventas({ term, edition, types, onlyInStock, sort });
    return json(data);
  } catch (err) {
    console.error("[/api/productos]", err.message);
    return error("Error al buscar productos.", 500, err.message);
  }
}
