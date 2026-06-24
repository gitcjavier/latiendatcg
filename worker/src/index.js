import { searchTCGMatch } from "./tcgmatch.js";
import { searchTCGPlayer } from "./tcgplayer.js";

export default {
  async fetch(request, env) {
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

    // Health check para monitoreo
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

    const [tcgmatchResult, tcgplayerResult] = await Promise.allSettled([
      searchTCGMatch(env, name, number, set),
      searchTCGPlayer(env, name, number, set),
    ]);

    return json(
      {
        query: { name, number, set },
        tcgmatch:
          tcgmatchResult.status === "fulfilled"
            ? tcgmatchResult.value
            : { error: tcgmatchResult.reason?.message, results: [], exactMatch: null },
        tcgplayer:
          tcgplayerResult.status === "fulfilled"
            ? tcgplayerResult.value
            : { error: tcgplayerResult.reason?.message, results: [], exactMatch: null },
      },
      200,
      corsHeaders,
    );
  },
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}
