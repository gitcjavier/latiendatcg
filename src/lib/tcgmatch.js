import axios from "axios";

// API pública detrás de tcgmatch.cl. Reemplaza el scraping con Puppeteer.
// Ver docs/adr/0002-tcgmatch-api-publica.md para el racional.
const API = "https://api.tcgmatch.cl";
const UA = "Mozilla/5.0 (compatible; pkm-prices/2.0; +https://latiendatcg.netlify.app)";
const TIMEOUT = 12000;
const HEADERS = {
  "User-Agent": UA,
  "Origin": "https://tcgmatch.cl",
  "Referer": "https://tcgmatch.cl/",
  "Accept": "application/json",
};

// Caché en memoria — la búsqueda de carta es casi siempre la misma durante una sesión.
const TTL = 30 * 60 * 1000; // 30 min
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;
  return null;
}
function cacheSet(key, data) { cache.set(key, { data, ts: Date.now() }); }

/**
 * Devuelve precios de TCGMatch (CLP) y TCGPlayer (USD) en una sola llamada.
 * @param {string} name
 * @param {string} number   ej. "199" o "199/165"
 * @param {string} set      nombre del set, ayuda al desambiguar
 * @returns {Promise<{ catalog, tcgmatch, tcgplayer }>}
 */
export async function getPricesFromTCGMatch(name, number, set) {
  const query = [name, number].filter(Boolean).join(" ").trim();
  const cacheKey = `${query}::${set || ""}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;

  const searchUrl = `https://www.tcgmatch.cl/cartas/busqueda/tcg=pokemon&q=${encodeURIComponent(query)}`;

  // La API de TCGMatch hace match exacto del número como texto: q="Blaziken ex 24"
  // devuelve 0 si el cardCode es "024/159". Probamos hasta 3 variantes para cubrir:
  //   1. "<name> <number>"     (caso simple)
  //   2. "<name> <padded3>"    ("024" en lugar de "24")
  //   3. "<name>"              (fallback, filtramos después por pickBest)
  const padded = number ? number.toString().padStart(3, "0") : "";
  const queries = unique([
    query,
    name && padded ? `${name} ${padded}` : null,
    name,
  ]);

  let candidates = [];
  for (const q of queries) {
    const res = await axios.get(`${API}/catalog/search`, {
      params: { tcg: "pokemon", q },
      headers: HEADERS,
      timeout: TIMEOUT,
    });
    candidates = res.data?.products || [];
    if (candidates.length) break;
  }

  if (!candidates.length) {
    const empty = emptyResult(searchUrl);
    cacheSet(cacheKey, empty);
    return empty;
  }

  // 2. Elegir el mejor match: por cardCode si tenemos number, sino primero
  const target = pickBest(candidates, number, set);

  // 3. Detalle + listings en paralelo
  const [catalogRes, listingsRes] = await Promise.allSettled([
    axios.get(`${API}/catalog/${target.id}`, { headers: HEADERS, timeout: TIMEOUT }),
    axios.get(`${API}/products/catalog/${target.id}`, {
      params: { inStock: "true" },
      headers: HEADERS,
      timeout: TIMEOUT,
    }),
  ]);

  const catalog = catalogRes.status === "fulfilled" ? catalogRes.value.data?.data : null;
  const listings = listingsRes.status === "fulfilled" ? (listingsRes.value.data?.data || []) : [];

  const result = {
    searchUrl,
    catalogId: target.id,
    matchedName: target.name,
    matchedSet: target.setName,
    tcgmatch: buildTcgmatchResult(catalog, listings, target),
    tcgplayer: buildTcgplayerResult(catalog),
  };

  cacheSet(cacheKey, result);
  return result;
}

function emptyResult(searchUrl) {
  return {
    searchUrl,
    catalogId: null,
    tcgmatch: { source: "tcgmatch", currency: "CLP", searchUrl, results: [], exactMatch: null },
    tcgplayer: { source: "tcgplayer", currency: "USD", results: [], exactMatch: null },
  };
}

function unique(arr) {
  const seen = new Set();
  return arr.filter(x => {
    if (!x) return false;
    if (seen.has(x)) return false;
    seen.add(x);
    return true;
  });
}

// Comparación numérica que ignora zero-padding: "24" == "024".
function sameNumber(a, b) {
  if (a == null || b == null) return false;
  const na = parseInt(String(a).split("/")[0], 10);
  const nb = parseInt(String(b).split("/")[0], 10);
  if (Number.isNaN(na) || Number.isNaN(nb)) return String(a) === String(b);
  return na === nb;
}

// Prefiere coincidencia exacta de cardCode + setName parecido
function pickBest(candidates, number, set) {
  const numClean = (number || "").trim();
  const setLower = (set || "").toLowerCase();
  if (numClean) {
    // Primero: number + set coinciden
    const withSet = candidates.find(c => {
      const setName = (c.setName || "").toLowerCase();
      const matchesSet = !setLower || setName.includes(setLower) || setLower.includes(setName);
      return sameNumber(c.cardCode, numClean) && matchesSet;
    });
    if (withSet) return withSet;
    // Si no, solo number — el primero que cuadre
    const numOnly = candidates.find(c => sameNumber(c.cardCode, numClean));
    if (numOnly) return numOnly;
  }
  // Sin number, intentamos por set
  if (setLower) {
    const bySet = candidates.find(c => {
      const setName = (c.setName || "").toLowerCase();
      return setName.includes(setLower) || setLower.includes(setName);
    });
    if (bySet) return bySet;
  }
  return candidates[0];
}

function buildTcgmatchResult(catalog, listings, target) {
  const detailUrl = catalog?._id ? `https://tcgmatch.cl/producto/catalogo/${catalog._id}` : null;
  const cardListings = listings
    .filter(l => l.category === "card" && typeof l.price === "number" && l.price > 0)
    .map(l => ({
      _id: l._id,
      price: l.price,
      language: l.language,           // "spanish" | "english" | otro
      condition: l.status,
      quantity: l.quantity ?? 1,
      seller: l.user?.username || l.user?.name || null,
      url: detailUrl,
      isHolo: !!l.isHolo,
    }))
    .sort((a, b) => a.price - b.price);

  const en = aggregateByLanguage(cardListings, "english");
  const es = aggregateByLanguage(cardListings, "spanish");
  const overallMin = cardListings[0]?.price ?? null;

  return {
    source: "tcgmatch",
    currency: "CLP",
    searchUrl: detailUrl || `https://www.tcgmatch.cl/cartas/busqueda/tcg=pokemon&q=${encodeURIComponent(target?.name || "")}`,
    results: cardListings.slice(0, 10).map(l => ({
      price: l.price,
      seller: l.seller,
      language: l.language,
      condition: l.condition,
      quantity: l.quantity,
      url: l.url,
    })),
    exactMatch: overallMin == null ? null : {
      name: target?.name,
      number: target?.cardCode,
      url: detailUrl,
      price: overallMin,
      stock: cardListings.length,
      ingles: en,
      espanol: es,
    },
  };
}

function aggregateByLanguage(listings, lang) {
  const filtered = listings.filter(l => (l.language || "").toLowerCase() === lang);
  if (!filtered.length) return null;
  return {
    minPrice: filtered[0].price,
    stock: filtered.length,
    listings: filtered.slice(0, 5).map(l => ({
      price: l.price,
      seller: l.seller,
      condition: l.condition,
    })),
  };
}

function buildTcgplayerResult(catalog) {
  const tp = catalog?.markets?.tcgplayer;
  if (!tp?.prices) {
    return { source: "tcgplayer", currency: "USD", results: [], exactMatch: null };
  }
  const market = typeof tp.prices.market === "number" ? tp.prices.market : null;
  const low = typeof tp.prices.low === "number" ? tp.prices.low : null;
  const url = tp.url || null;
  return {
    source: "tcgplayer",
    currency: "USD",
    searchUrl: url,
    results: market != null ? [{ price: market, url, source: "market" }] : [],
    exactMatch: market != null ? {
      name: catalog.name || null,
      url,
      price: market,
      low,
      mid: tp.prices.mid ?? null,
      high: tp.prices.high ?? null,
      stock: null,
    } : null,
  };
}
