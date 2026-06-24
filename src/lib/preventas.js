import axios from "axios";

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Caché corta — las preventas cambian poco durante el día
const TTL = 30 * 60 * 1000; // 30 min
const cache = new Map(); // term -> { data, ts }

/**
 * Tiendas chilenas con preventas. Cada una se consulta por su API pública:
 *  - shopify: lee la colección "preventas" (products.json) y filtra por término
 *  - woo:     WooCommerce Store API con búsqueda server-side
 */
export const STORES = [
  { id: 'collectorcenter', name: 'Collector Center', type: 'shopify', domain: 'collectorcenter.cl', collection: 'preventas' },
  { id: 'updown',          name: 'Updown',           type: 'woo',     domain: 'www.updown.cl' },
  { id: 'huntercard',      name: 'HunterCard',       type: 'woo',     domain: 'www.huntercardtcg.com' },
  { id: 'eternia',         name: 'Tienda Eternia',   type: 'shopify', domain: 'tiendaeternia.com', collection: 'preventas' },
];

// Tipos de producto detectables por título. El orden importa: el primer match gana.
// id: usado en filtros y query params. label: nombre amigable en la UI.
export const PRODUCT_TYPES = [
  { id: 'etb',        label: 'ETB',                patterns: [/elite\s*trainer\s*box/i, /\betb\b/i, /caja\s*de\s*entrenador/i] },
  { id: 'booster_box',label: 'Booster Box',        patterns: [/booster\s*box/i, /caja\s*de\s*sobres/i, /display/i] },
  { id: 'bundle',     label: 'Booster Bundle',     patterns: [/booster\s*bundle/i, /bundle/i] },
  { id: 'premium',    label: 'Premium Collection', patterns: [/premium\s*collection/i, /colecci[oó]n\s*premium/i, /collection\s*box/i] },
  { id: 'tin',        label: 'Tin / Lata',         patterns: [/\btin\b/i, /\blata\b/i] },
  { id: 'pack',       label: 'Sobre',              patterns: [/booster\s*pack/i, /\bsobre\b/i, /\bpack\b/i] },
];

function detectType(title) {
  const t = (title || '');
  for (const pt of PRODUCT_TYPES) {
    if (pt.patterns.some(rx => rx.test(t))) return pt.id;
  }
  return null;
}

/**
 * Busca productos en todas las tiendas y aplica filtros.
 * @param {object} opts
 * @param {string} [opts.term]    término libre
 * @param {string} [opts.edition] nombre de la edición (se trata como otro término)
 * @param {string[]} [opts.types] ids de PRODUCT_TYPES para filtrar
 * @param {boolean} [opts.onlyInStock] si true, descarta productos sin stock
 * @param {"asc"|"desc"} [opts.sort] orden por precio (default "asc")
 */
export async function searchPreventas(opts = {}) {
  // Soporte legacy: si recibe string, es el term.
  if (typeof opts === 'string') opts = { term: opts };
  const term = (opts.term ?? '').trim();
  const edition = (opts.edition ?? '').trim();
  const types = Array.isArray(opts.types) ? opts.types.filter(Boolean) : [];
  const onlyInStock = !!opts.onlyInStock;
  const sort = opts.sort === 'desc' ? 'desc' : 'asc';

  // Para el scrape, combinamos term + edition como query global. El filtro fino
  // de tipo se aplica después en memoria.
  const queryTerm = [edition, term].filter(Boolean).join(' ').toLowerCase();

  const cacheKey = JSON.stringify({ q: queryTerm, types, onlyInStock, sort });
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const settled = await Promise.allSettled(
    STORES.map(s => (s.type === 'shopify' ? shopifyPreventas(s, queryTerm) : wooSearch(s, queryTerm)))
  );

  const enriched = STORES.map((s, i) => {
    const raw = settled[i].status === 'fulfilled' ? settled[i].value : [];
    const products = raw
      .map(p => ({ ...p, type: detectType(p.title) }))
      .filter(p => types.length === 0 || (p.type && types.includes(p.type)))
      .filter(p => !onlyInStock || p.available);
    return {
      storeId: s.id,
      store: s.name,
      products,
      error: settled[i].status === 'rejected' ? (settled[i].reason?.message || 'error') : null,
    };
  });

  // Solo devolvemos en `stores` las tiendas que aportaron resultados (>0)
  // o que erroraron — así la UI no tiene que listar tiendas hardcoded.
  const stores = enriched.filter(s => s.products.length > 0 || s.error);

  const products = enriched
    .flatMap(s => s.products)
    .sort((a, b) => {
      const ap = a.price ?? Infinity;
      const bp = b.price ?? Infinity;
      return sort === 'desc' ? bp - ap : ap - bp;
    });

  const data = { term, edition, types, onlyInStock, sort, stores, products, total: products.length };
  cache.set(cacheKey, { data, ts: Date.now() });
  return data;
}

// ── Shopify: colección de preventas, filtrada por término ──
async function shopifyPreventas(store, term) {
  const url = `https://${store.domain}/collections/${store.collection || 'preventas'}/products.json?limit=250`;
  const res = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 12000 });
  const products = res.data?.products || [];

  return products
    .map(p => {
      const v = (p.variants || [])[0] || {};
      return {
        storeId: store.id,
        store: store.name,
        title: p.title,
        price: parsePrice(v.price),
        available: !!v.available,
        url: `https://${store.domain}/products/${p.handle}`,
        image: p.images?.[0]?.src || '',
      };
    })
    .filter(x => x.price != null && matchTerm(x.title, term));
}

// ── WooCommerce Store API: búsqueda server-side ──
async function wooSearch(store, term) {
  const q = term ? `&search=${encodeURIComponent(term)}` : '';
  const url = `https://${store.domain}/wp-json/wc/store/v1/products?per_page=30${q}`;
  const res = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 12000 });
  const products = Array.isArray(res.data) ? res.data : [];

  return products
    .map(p => {
      const pr = p.prices || {};
      const minor = pr.currency_minor_unit || 0;
      const price = pr.price != null && pr.price !== ''
        ? Math.round(parseInt(pr.price, 10) / Math.pow(10, minor))
        : null;
      return {
        storeId: store.id,
        store: store.name,
        title: p.name,
        price,
        available: !!p.is_in_stock,
        url: p.permalink,
        image: p.images?.[0]?.src || '',
      };
    })
    .filter(x => x.price != null);
}

// Precio Shopify viene como string "34990" o "34990.00" → entero CLP
function parsePrice(s) {
  if (s == null) return null;
  const n = Math.round(parseFloat(String(s)));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Coincide si todas las palabras del término están en el título
function matchTerm(title, term) {
  if (!term) return true;
  const t = (title || '').toLowerCase();
  return term.split(/\s+/).filter(Boolean).every(w => t.includes(w));
}

