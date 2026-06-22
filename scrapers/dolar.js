const axios = require('axios');

let cache = { rate: null, fetchedAt: 0 };
const TTL = 60 * 60 * 1000; // 1 hora

async function getDolarRate() {
  if (cache.rate && Date.now() - cache.fetchedAt < TTL) return cache.rate;

  try {
    // mindicador.cl — API pública chilena de indicadores económicos
    const res = await axios.get('https://mindicador.cl/api/dolar', { timeout: 6000 });
    const valor = res.data?.serie?.[0]?.valor;
    if (valor && valor > 0) {
      cache = { rate: valor, fetchedAt: Date.now() };
      return valor;
    }
  } catch (_) {}

  // Fallback: exchangerate-api
  try {
    const res = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 6000 });
    const valor = res.data?.rates?.CLP;
    if (valor && valor > 0) {
      cache = { rate: valor, fetchedAt: Date.now() };
      return valor;
    }
  } catch (_) {}

  return cache.rate || null;
}

module.exports = { getDolarRate };
