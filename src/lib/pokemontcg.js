import axios from "axios";

const API_BASE = 'https://api.pokemontcg.io/v2';

// Caché en memoria (cambian poco) — patrón similar a dolar.js.
// pokemontcg.io sin API key es lento y con límite agresivo, así que
// cacheamos sets y también cada página de cartas por set.
const SETS_TTL = 6 * 60 * 60 * 1000; // 6 horas
const CARDS_TTL = 6 * 60 * 60 * 1000;
let setsCache = { data: null, ts: 0 };
const cardsCache = new Map(); // key `${setId}:${page}` -> { data, ts }

function authHeaders() {
  const key = process.env.POKEMONTCG_KEY ?? import.meta.env?.POKEMONTCG_KEY;
  return key ? { "X-Api-Key": key } : {};
}

// GET con un reintento — la API pública responde lento de vez en cuando
async function getWithRetry(url, params) {
  try {
    return await axios.get(url, { params, headers: authHeaders(), timeout: 25000 });
  } catch (err) {
    return await axios.get(url, { params, headers: authHeaders(), timeout: 25000 });
  }
}

/**
 * Lista los sets del formato estándar, ordenados del más nuevo al más antiguo.
 * Devuelve: [{ id, name, series, releaseDate, total, logo, symbol }]
 */
export async function getStandardSets() {
  if (setsCache.data && Date.now() - setsCache.ts < SETS_TTL) {
    return setsCache.data;
  }

  const res = await getWithRetry(`${API_BASE}/sets`, {
    q: 'legalities.standard:legal',
    orderBy: '-releaseDate',
    pageSize: 250,
  });

  const sets = (res.data?.data || []).map(normalizeSet);
  setsCache = { data: sets, ts: Date.now() };
  return sets;
}

/**
 * Obtiene las cartas de un set, paginado. Devuelve cartas normalizadas
 * con el mismo shape consistente que searchCardsByName.
 *
 * pokemontcg.io ordena `number` como texto ("1,10,100,11,2..."), así que
 * traemos TODAS las cartas del set una vez, las ordenamos numéricamente por
 * número de carta (el orden de colección real) y las cacheamos. Las páginas
 * se sirven desde esa lista ordenada para que el orden sea correcto y global.
 *
 * Devuelve: { cards, page, totalCount, hasMore }
 */
export async function getCardsBySet(setId, page = 1) {
  const pageSize = 60;

  let all = null;
  const cached = cardsCache.get(setId);
  if (cached && Date.now() - cached.ts < CARDS_TTL) {
    all = cached.cards;
  } else {
    all = await fetchAllCards(setId);
    all.sort(cardOrder);
    cardsCache.set(setId, { cards: all, ts: Date.now() });
  }

  const totalCount = all.length;
  const start = (page - 1) * pageSize;
  const cards = all.slice(start, start + pageSize);

  return {
    cards,
    page,
    totalCount,
    hasMore: start + pageSize < totalCount,
  };
}

// Trae todas las cartas de un set (pokemontcg.io permite hasta 250 por página)
async function fetchAllCards(setId) {
  const apiPageSize = 250;
  const out = [];
  let p = 1, total = Infinity;
  while (out.length < total) {
    const res = await getWithRetry(`${API_BASE}/cards`, {
      q: `set.id:${setId}`,
      page: p,
      pageSize: apiPageSize,
    });
    const raw = res.data || {};
    const batch = (raw.data || []).map(normalizeCard);
    out.push(...batch);
    total = raw.totalCount ?? out.length;
    if (!batch.length) break;
    p++;
  }
  return out;
}

// Orden de colección: número numérico ascendente; los no numéricos
// (promos, Trainer Gallery "TG01", etc.) van después, en orden natural.
function cardOrder(a, b) {
  const na = parseInt(String(a.number).match(/^\d+/)?.[0] ?? '', 10);
  const nb = parseInt(String(b.number).match(/^\d+/)?.[0] ?? '', 10);
  const aNum = !Number.isNaN(na);
  const bNum = !Number.isNaN(nb);
  if (aNum && bNum) {
    if (na !== nb) return na - nb;
    return String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
  }
  if (aNum) return -1;
  if (bNum) return 1;
  return String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
}

function normalizeSet(s) {
  return {
    id: s.id || '',
    name: s.name || '',
    series: s.series || '',
    releaseDate: s.releaseDate || '',
    total: s.total ?? s.printedTotal ?? 0,
    logo: s.images?.logo || '',
    symbol: s.images?.symbol || '',
  };
}

// Shape consistente para todos los endpoints que devuelven cartas.
// Preservamos los precios de TCGPlayer que vienen directos en la API.
function normalizeCard(c) {
  return {
    id: c.id || '',
    name: c.name || '',
    set: c.set?.name || c.series || '',
    setId: c.set?.id || '',
    setPrintedTotal: c.set?.printedTotal ?? null,
    setTotal: c.set?.total ?? null,
    number: c.number || '',
    rarity: c.rarity || '',
    supertype: c.supertype || '',
    subtypes: c.subtypes || [],
    types: c.types || [],
    hp: c.hp || '',
    artist: c.artist || '',
    images: {
      small: c.images?.small || '',
      large: c.images?.large || '',
    },
    tcgpMarket: extractTcgpMarket(c.tcgplayer?.prices),
    tcgpUrl: c.tcgplayer?.url || '',
  };
}

/**
 * Extrae el "market price" más representativo de la respuesta de pokemontcg.io.
 * Prioriza variantes comunes (holofoil > normal > reverseHolofoil > 1stEdition…).
 */
function extractTcgpMarket(prices) {
  if (!prices) return null;
  const order = [
    'holofoil',
    'normal',
    'reverseHolofoil',
    'unlimitedHolofoil',
    '1stEditionHolofoil',
    '1stEditionNormal',
  ];
  for (const k of order) {
    const v = prices[k]?.market;
    if (typeof v === 'number' && v > 0) return v;
  }
  // Fallback: el primero que encontremos
  for (const v of Object.values(prices)) {
    if (typeof v?.market === 'number' && v.market > 0) return v.market;
  }
  return null;
}

/**
 * Clasifica el input del buscador en nombre / número / nombre + número.
 *
 * Soporta:
 *   "charizard ex"     → { name: "charizard ex" }
 *   "022"              → { number: 22 }
 *   "022/086"          → { number: 22, printedTotal: 86 }
 *   "charizard 022"    → { name: "charizard", number: 22 }
 *   "022 charizard"    → { name: "charizard", number: 22 }
 *
 * Devolvemos `number` como int para construir el query Lucene sin zero-padding
 * (pokemontcg.io guarda "22" no "022"). `printedTotal` se aplica como filtro
 * post-fetch porque su shape varía mucho entre sets.
 */
export function parseSearchInput(raw) {
  const s = (raw || '').trim();
  if (!s) return { name: '' };

  // Solo número o código completo
  const onlyCode = s.match(/^(\d{1,3})(?:\/(\d{1,3}))?$/);
  if (onlyCode) {
    return {
      number: parseInt(onlyCode[1], 10),
      printedTotal: onlyCode[2] != null ? parseInt(onlyCode[2], 10) : null,
    };
  }

  // <nombre> <código> o <código> <nombre>
  const nameThenCode = s.match(/^(.+?)\s+(\d{1,3})(?:\/(\d{1,3}))?$/);
  if (nameThenCode) {
    return {
      name: nameThenCode[1].trim(),
      number: parseInt(nameThenCode[2], 10),
      printedTotal: nameThenCode[3] != null ? parseInt(nameThenCode[3], 10) : null,
    };
  }
  const codeThenName = s.match(/^(\d{1,3})(?:\/(\d{1,3}))?\s+(.+?)$/);
  if (codeThenName) {
    return {
      name: codeThenName[3].trim(),
      number: parseInt(codeThenName[1], 10),
      printedTotal: codeThenName[2] != null ? parseInt(codeThenName[2], 10) : null,
    };
  }

  return { name: s };
}

/**
 * Búsqueda de cartas. Acepta nombre, código ("022"), código completo
 * ("022/086") o nombre + código. Construye el query Lucene de pokemontcg.io
 * según corresponda y filtra por printedTotal cuando viene en el input.
 */
export async function searchCards(input) {
  const parsed = parseSearchInput(input);
  const parts = [];
  if (parsed.name) parts.push(`name:"${parsed.name}"`);
  if (typeof parsed.number === 'number') parts.push(`number:${parsed.number}`);

  if (!parts.length) return { total: 0, cards: [] };

  const res = await getWithRetry(`${API_BASE}/cards`, {
    q: parts.join(' '),
    orderBy: '-set.releaseDate',
    pageSize: 50,
  });

  const raw = res.data || {};
  let cards = (raw.data || []).map(normalizeCard);

  // "022/086" → filtramos por printedTotal del set.
  if (parsed.printedTotal != null) {
    const t = parsed.printedTotal;
    cards = cards.filter(c => c.setPrintedTotal === t || c.setTotal === t);
  }

  return {
    total: parsed.printedTotal != null ? cards.length : (raw.totalCount ?? cards.length),
    cards,
  };
}

// Alias para no romper imports existentes (api/cards.js, index.astro).
export const searchCardsByName = searchCards;

