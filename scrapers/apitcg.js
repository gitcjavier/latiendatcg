const axios = require('axios');

const API_BASE = 'https://apitcg.com/api/pokemon/cards';

async function searchCards(name) {
  const key = process.env.API_TCG_KEY;
  if (!key) throw new Error('API_TCG_KEY no configurada en .env');

  const response = await axios.get(API_BASE, {
    params: { name },
    headers: { 'x-api-key': key },
    timeout: 10000,
  });

  const raw = response.data;
  const cards = Array.isArray(raw) ? raw : (raw.data || []);

  return {
    total: raw.totalCount ?? cards.length,
    cards: cards.map(normalizeCard),
  };
}

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

module.exports = { searchCards };
