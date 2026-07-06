import axios from "axios";

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Caché corta — las preventas cambian poco durante el día
const TTL = 30 * 60 * 1000; // 30 min
const cache = new Map(); // term -> { data, ts }

/**
 * Tiendas chilenas con preventas. Cada una se consulta por su API pública:
 *  - shopify: lee la colección "preventas" (products.json) y filtra por término
 *  - woo:     WooCommerce Store API con búsqueda server-side
 *  - theway:  scraping HTML de la categoría 30° aniversario en Jumpseller
 */
export const STORES = [
  { id: 'collectorcenter', name: 'Collector Center', type: 'shopify', domain: 'collectorcenter.cl', collection: 'preventas' },
  { id: 'updown',          name: 'Updown',           type: 'woo',     domain: 'www.updown.cl' },
  { id: 'huntercard',      name: 'HunterCard',       type: 'woo',     domain: 'www.huntercardtcg.com' },
  { id: 'eternia',         name: 'Tienda Eternia',   type: 'shopify', domain: 'tiendaeternia.com', collection: 'preventas' },
  { id: 'theway',          name: 'The Way',          type: 'theway',  domain: 'www.theway.cl',     category: '/pokemon-tcg/30-aniversario-pokemon' },
];

// Tipos de producto detectables por título. El orden importa: el primer match gana.
// id: usado en filtros y query params. label: nombre amigable en la UI.
export const PRODUCT_TYPES = [
  { id: 'etb',        label: 'ETB',                patterns: [/elite\s*trainer\s*box/i, /\betb\b/i, /caja\s*de\s*entrenador/i] },
  { id: 'booster_box',label: 'Booster Box',        patterns: [/booster\s*box/i, /caja\s*de\s*sobres/i, /display/i] },
  { id: 'bundle',     label: 'Booster Bundle',     patterns: [/booster\s*bundle/i, /bundle/i] },
  { id: 'premium',    label: 'Premium Collection', patterns: [/premium\s*collection/i, /colecci[oó]n\s*premium/i, /collection\s*box/i] },
  { id: 'poster',     label: 'Poster Collection',  patterns: [/poster\s*collection/i] },
  { id: 'sticker',    label: 'Sticker Collection', patterns: [/(tech\s*)?sticker\s*collection/i, /colecci[oó]n\s*de\s*stickers/i] },
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
    STORES.map(s => {
      if (s.type === 'shopify') return shopifyPreventas(s, queryTerm);
      if (s.type === 'woo')     return wooSearch(s, queryTerm);
      if (s.type === 'theway')  return thewayCategory(s, queryTerm);
      return Promise.resolve([]);
    }),
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

// ────────────────────────────────────────────────────────────────────────────
// 30° Aniversario Pokémon TCG
// ────────────────────────────────────────────────────────────────────────────

// Variantes con las que las tiendas chilenas suelen etiquetar los productos.
// Los ejecutamos en paralelo y deduplicamos por (storeId, url).
// Todos los términos incluyen "pokemon" para no traer Yu-Gi-Oh, Bastemon, etc.
export const ANIVERSARIO_TERMS = [
  'pokemon 30',
  'pokemon aniversario',
  'pokemon anniversary',
  'pokémon 30',
  'pokemon 30th',
];

// Filtro final: el título del producto debe mencionar Pokémon explícitamente
// Y una marca de aniversario. Aunque la query ya lo pidió, algunas tiendas
// devuelven productos parciales en su search. Sólo "30" a secas no basta
// (traería rompecabezas de 300 piezas), así que exigimos "30" pegado a alguna
// palabra tipo "years/años/anniversary/aniversario/th".
const ANIVERSARIO_TITLE_REGEX = /pok[eé]mon/i;
const ANIVERSARIO_MARK_REGEX = /(30\s*(th|years?|años?|anniv(ersary)?|aniversario)|30th)/i;

/**
 * Busca productos del 30° aniversario Pokémon TCG en todas las tiendas y los
 * agrupa por categoría (ETB, Booster Box, Bundle…), cada grupo ordenado del
 * más barato al más caro. Descarta productos sin tipo detectado (sleeves,
 * playmats, dice, etc.) para no ensuciar la vista.
 *
 * @param {object} opts
 * @param {boolean} [opts.onlyInStock=false]
 * @returns {Promise<{ total: number, groups: Array<{ typeId, label, products: [] }> }>}
 */
export async function searchAniversario30({ onlyInStock = false } = {}) {
  const runs = await Promise.allSettled(
    ANIVERSARIO_TERMS.map(term =>
      searchPreventas({ term, onlyInStock, sort: 'asc' }),
    ),
  );

  const seen = new Set();
  const all = [];
  for (const r of runs) {
    if (r.status !== 'fulfilled') continue;
    for (const p of r.value.products) {
      if (!p.type) continue;
      // Filtro estricto: título debe mencionar Pokémon Y alguna marca de aniversario
      const t = p.title || '';
      if (!ANIVERSARIO_TITLE_REGEX.test(t)) continue;
      if (!ANIVERSARIO_MARK_REGEX.test(t)) continue;
      const key = `${p.storeId}::${p.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(p);
    }
  }

  const groups = PRODUCT_TYPES
    .map(pt => ({
      typeId: pt.id,
      label: pt.label,
      products: all
        .filter(p => p.type === pt.id)
        .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)),
    }))
    .filter(g => g.products.length > 0);

  return { total: all.length, groups };
}

// ── The Way (Jumpseller): scraping HTML de la categoría ──
// Jumpseller no expone products.json públicamente en theway.cl, así que
// parseamos el HTML del listado por categoría. Cada tarjeta es un
// <div class="product-block" data-productid="XXX">…</div> con un shape estable.
async function thewayCategory(store, term) {
  const url = `https://${store.domain}${store.category}`;
  const res = await axios.get(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-CL,es;q=0.9',
    },
    timeout: 12000,
  });
  const html = res.data || '';
  const products = parseThewayHtml(html, store);
  return products.filter(p => matchTerm(p.title, term));
}

// Extrae productos del HTML del listado. Usa regex sobre bloques delimitados
// por `data-productid` — el HTML es plano y consistente.
function parseThewayHtml(html, store) {
  const out = [];
  const blockRegex = /data-productid="(\d+)"([\s\S]*?)(?=data-productid="\d+"|$)/g;
  let m;
  while ((m = blockRegex.exec(html)) !== null) {
    const productId = m[1];
    const block = m[2];

    const alt = block.match(/<img[^>]*alt="([^"]+)"/);
    const title = alt ? decodeHtmlEntities(alt[1]) : null;
    if (!title) continue;

    const hrefMatch = block.match(/<a[^>]+href="(\/[^"#?]+)"/);
    const path = hrefMatch ? hrefMatch[1] : null;
    if (!path) continue;

    const imgMatch = block.match(/<img[^>]+src="(https?:\/\/[^"]+)"/);
    const image = imgMatch ? imgMatch[1] : '';

    // Precio: primero sale-color/sale/regular. En ese orden aparece el vigente.
    const priceMatch =
      block.match(/<span[^>]+class="sale-color[^"]*"[^>]*>\$?([\d.,]+)/) ||
      block.match(/<span[^>]+class="[^"]*\bsale\b[^"]*"[^>]*>\$?([\d.,]+)/) ||
      block.match(/<span[^>]+class="[^"]*\bregular\b[^"]*"[^>]*>\$?([\d.,]+)/);
    const price = priceMatch ? parseChileanPrice(priceMatch[1]) : null;
    if (price == null) continue;

    // Con stock si hay <form action="/cart/add/..."> con max > 0.
    const maxMatch = block.match(/name="qty"[^>]*max="(\d+)"/);
    const hasAddForm = /<form[^>]+action="\/cart\/add\/\d+"/.test(block);
    const available = hasAddForm && (!maxMatch || parseInt(maxMatch[1], 10) > 0);

    out.push({
      storeId: store.id,
      store: store.name,
      title,
      price,
      available,
      url: `https://${store.domain}${path}`,
      image,
    });
  }
  return out;
}

// "$20.490" en Chile usa punto como separador de miles → 20490
function parseChileanPrice(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&percnt;/g, '%');
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

