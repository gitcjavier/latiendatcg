import { json, error } from "../../lib/respond.js";

export const prerender = false;

/**
 * /api/prices proxy → reenvía al Cloudflare Worker que hace el scraping
 * (TCGMatch + TCGPlayer) usando Browser Rendering. La URL del Worker se
 * configura con la env PRICES_BACKEND_URL. Si no está, devuelve 503.
 */
export async function GET({ url }) {
  const backend =
    process.env.PRICES_BACKEND_URL ?? import.meta.env?.PRICES_BACKEND_URL;

  if (!backend) {
    return error(
      "Backend de precios no configurado. Define PRICES_BACKEND_URL apuntando al Cloudflare Worker.",
      503,
    );
  }

  const name = url.searchParams.get("name")?.trim();
  if (!name || name.length < 2) {
    return error("Nombre de carta requerido.", 400);
  }

  const upstream = new URL("/api/prices", backend);
  for (const [k, v] of url.searchParams.entries()) upstream.searchParams.set(k, v);

  try {
    const r = await fetch(upstream.toString(), {
      // En producción Netlify Functions tiene 26s. En dev (mini-server local con
      // Puppeteer normal) puede demorar más, así que dejamos margen ancho.
      signal: AbortSignal.timeout(120000),
    });
    const data = await r.json();
    return json(data, r.status);
  } catch (err) {
    console.error("[/api/prices proxy]", err.message);
    return error("No se pudo contactar el backend de precios.", 502, err.message);
  }
}
