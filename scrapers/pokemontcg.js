const axios = require('axios');

const API_BASE = 'https://api.pokemontcg.io/v2';

// Caché en memoria (cambian poco) — patrón similar a dolar.js.
// pokemontcg.io sin API key es lento y con límite agresivo, así que
// cacheamos sets y también cada página de cartas por set.
const SETS_TTL = 6 * 60 * 60 * 1000; // 6 horas
const CARDS_TTL = 6 * 60 * 60 * 1000;
let setsCache = { data: null, ts: 0 };
const cardsCache = new Map(); // key `${setId}:${page}` -> { data, ts }

function authHeaders() {
  const key = process.env.POKEMONTCG_KEY;
  return key ? { 'X-Api-Key': key } : {};
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
async function getStandardSets() {
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
 * Obtiene las cartas de un set, paginado. Normaliza al MISMO shape que
 * normalizeCard de apitcg.js para que el grid y /api/prices funcionen igual.
 *
 * pokemontcg.io ordena `number` como texto ("1,10,100,11,2..."), así que
 * traemos TODAS las cartas del set una vez, las ordenamos numéricamente por
 * número de carta (el orden de colección real) y las cacheamos. Las páginas
 * se sirven desde esa lista ordenada para que el orden sea correcto y global.
 *
 * Devuelve: { cards, page, totalCount, hasMore }
 */
async function getCardsBySet(setId, page = 1) {
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

// Mismo shape que normalizeCard de apitcg.js — crítico para reutilizar el render
function normalizeCard(c) {
  return {
    id: c.id || '',
    name: c.name || '',
    set: c.set?.name || c.series || '',
    setId: c.set?.id || '',
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
  };
}

module.exports = { getStandardSets, getCardsBySet };
