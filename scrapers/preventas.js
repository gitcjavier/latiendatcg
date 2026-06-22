const axios = require('axios');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Caché corta — las preventas cambian poco durante el día
const TTL = 30 * 60 * 1000; // 30 min
const cache = new Map(); // term -> { data, ts }

/**
 * Tiendas chilenas con preventas. Cada una se consulta por su API pública:
 *  - shopify: lee la colección "preventas" (products.json) y filtra por término
 *  - woo:     WooCommerce Store API con búsqueda server-side
 */
const STORES = [
  { id: 'collectorcenter', name: 'Collector Center', type: 'shopify', domain: 'collectorcenter.cl', collection: 'preventas' },
  { id: 'updown',          name: 'Updown',           type: 'woo',     domain: 'www.updown.cl' },
  { id: 'huntercard',      name: 'HunterCard',       type: 'woo',     domain: 'www.huntercardtcg.com' },
  { id: 'eternia',         name: 'Tienda Eternia',   type: 'shopify', domain: 'tiendaeternia.com', collection: 'preventas' },
];

async function searchPreventas(term = '') {
  const key = term.toLowerCase().trim();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const settled = await Promise.allSettled(
    STORES.map(s => (s.type === 'shopify' ? shopifyPreventas(s, key) : wooSearch(s, key)))
  );

  const stores = STORES.map((s, i) => ({
    storeId: s.id,
    store: s.name,
    products: settled[i].status === 'fulfilled' ? settled[i].value : [],
    error: settled[i].status === 'rejected' ? (settled[i].reason?.message || 'error') : null,
  }));

  const products = stores
    .flatMap(s => s.products)
    .sort((a, b) => (a.price || Infinity) - (b.price || Infinity));

  const data = { term, stores, products, total: products.length };
  cache.set(key, { data, ts: Date.now() });
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

module.exports = { searchPreventas, STORES };
