import { searchTCGMatch } from "./tcgmatch.js";
import { searchTCGPlayer } from "./tcgplayer.js";

// Caché de precios — ver docs/adr/0001-caching-strategy-precios.md
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 horas

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/healthz") {
      return json({ ok: true, ts: Date.now() }, 200, corsHeaders);
    }

    if (url.pathname !== "/api/prices") {
      return json({ error: "Not found" }, 404, corsHeaders);
    }

    const name = url.searchParams.get("name")?.trim();
    const number = (url.searchParams.get("number") || "").trim();
    const set = (url.searchParams.get("set") || "").trim();

    if (!name || name.length < 2) {
      return json({ error: "Nombre de carta requerido." }, 400, corsHeaders);
    }

    // Cache key: URL canónico con los 3 params normalizados.
    const cacheKey = new Request(canonicalCacheUrl(url, name, number, set), {
      method: "GET",
    });
    const cache = caches.default;

    const cached = await cache.match(cacheKey);
    if (cached) {
      const body = await cached.json();
      return json({ ...body, cached: true }, 200, corsHeaders);
    }

    // Serial — el free tier de Browser Rendering tiene un límite de
    // launches/min muy bajo. En paralelo el segundo siempre da 429.
    const tcgmatchResult = await safeRun(() => searchTCGMatch(env, name, number, set));
    const tcgplayerResult = await safeRun(() => searchTCGPlayer(env, name, number, set));

    const body = {
      query: { name, number, set },
      tcgmatch: tcgmatchResult,
      tcgplayer: tcgplayerResult,
    };

    // Solo cacheamos respuestas válidas — al menos un scraper trajo datos.
    // Evita contaminar el caché con 429s o caídas momentáneas.
    if (isCacheable(body)) {
      const cacheable = new Response(JSON.stringify({ ...body, cachedAt: Date.now() }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
        },
      });
      // No bloqueamos la respuesta al cliente esperando el put.
      ctx.waitUntil(cache.put(cacheKey, cacheable));
    }

    return json(body, 200, corsHeaders);
  },
};

function canonicalCacheUrl(url, name, number, set) {
  const params = new URLSearchParams({ name, number, set });
  return `${url.origin}/api/prices?${params.toString()}`;
}

function isCacheable(body) {
  const tcgm = body.tcgmatch;
  const tcgp = body.tcgplayer;
  const tcgmOk = tcgm && !tcgm.error && ((tcgm.results?.length ?? 0) > 0 || tcgm.exactMatch);
  const tcgpOk = tcgp && !tcgp.error && ((tcgp.results?.length ?? 0) > 0 || tcgp.exactMatch);
  return Boolean(tcgmOk || tcgpOk);
}

async function safeRun(fn) {
  try {
    return await fn();
  } catch (err) {
    return { error: err?.message || String(err), results: [], exactMatch: null };
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}
