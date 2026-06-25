import { json, error } from "../../lib/respond.js";
import { getPricesFromTCGMatch } from "../../lib/tcgmatch.js";
import { getDolarRate } from "../../lib/dolar.js";

export const prerender = false;

/**
 * /api/prices — precios de TCGMatch (CLP) y TCGPlayer (USD) en un solo call.
 *
 * Usa la API JSON pública de tcgmatch.cl directamente desde Netlify SSR —
 * sin Puppeteer, sin Cloudflare Worker, sin rate limits.
 *
 * Ver docs/adr/0002-tcgmatch-api-publica.md para el contexto de la migración.
 */
export async function GET({ url }) {
  const name = url.searchParams.get("name")?.trim();
  const number = (url.searchParams.get("number") || "").trim();
  const set = (url.searchParams.get("set") || "").trim();

  if (!name || name.length < 2) {
    return error("Nombre de carta requerido.", 400);
  }

  try {
    const [prices, dolar] = await Promise.allSettled([
      getPricesFromTCGMatch(name, number, set),
      getDolarRate(),
    ]);

    if (prices.status === "rejected") {
      throw prices.reason;
    }

    const dolarRate = dolar.status === "fulfilled" ? dolar.value ?? null : null;

    return json({
      query: { name, number, set },
      dolarRate,
      tcgmatch: prices.value.tcgmatch,
      tcgplayer: prices.value.tcgplayer,
      catalogId: prices.value.catalogId,
    });
  } catch (err) {
    console.error("[/api/prices]", err.message);
    return error("Error al consultar precios.", 502, err.message);
  }
}
