require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { searchTCGMatch } = require('./scrapers/tcgmatch');
const { searchTCGPlayer } = require('./scrapers/tcgplayer');
const { searchCards } = require('./scrapers/apitcg');
const { getStandardSets, getCardsBySet } = require('./scrapers/pokemontcg');
const { searchPreventas } = require('./scrapers/preventas');
const { getDolarRate } = require('./scrapers/dolar');
const { closeBrowser } = require('./scrapers/browser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Demasiadas solicitudes, espera un momento.' },
});
app.use('/api/', limiter);

// GET /api/cards?name=charizard
app.get('/api/cards', async (req, res) => {
  const { name } = req.query;
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Nombre de carta requerido (mínimo 2 caracteres).' });
  }
  try {
    const data = await searchCards(name.trim());
    res.json(data);
  } catch (err) {
    console.error('[/api/cards]', err.message);
    res.status(500).json({ error: 'Error al buscar cartas.', detail: err.message });
  }
});

// GET /api/sets — ediciones del formato estándar (con logos)
app.get('/api/sets', async (req, res) => {
  try {
    const sets = await getStandardSets();
    res.json({ total: sets.length, sets });
  } catch (err) {
    console.error('[/api/sets]', err.message);
    res.status(500).json({ error: 'Error al obtener ediciones.', detail: err.message });
  }
});

// GET /api/preventas?q=pitch+black — preventas en tiendas chilenas
app.get('/api/preventas', async (req, res) => {
  const term = (req.query.q || '').trim();
  try {
    const data = await searchPreventas(term);
    res.json(data);
  } catch (err) {
    console.error('[/api/preventas]', err.message);
    res.status(500).json({ error: 'Error al buscar preventas.', detail: err.message });
  }
});

// GET /api/upcoming — ediciones próximas (lista curada, aún no en pokemontcg.io)
app.get('/api/upcoming', (req, res) => {
  try {
    const data = require('./data/upcoming.json');
    res.json({ upcoming: data.upcoming || [] });
  } catch (err) {
    console.error('[/api/upcoming]', err.message);
    res.json({ upcoming: [] });
  }
});

// GET /api/sets/:id/cards?page=1 — cartas de una edición (paginado)
app.get('/api/sets/:id/cards', async (req, res) => {
  const { id } = req.params;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  try {
    const data = await getCardsBySet(id, page);
    res.json(data);
  } catch (err) {
    console.error('[/api/sets/:id/cards]', err.message);
    res.status(500).json({ error: 'Error al obtener cartas de la edición.', detail: err.message });
  }
});

// GET /api/prices?name=Charizard&number=25&set=Vivid+Voltage
// Scrapea precios + obtiene tipo de cambio en paralelo
app.get('/api/prices', async (req, res) => {
  const { name, number, set } = req.query;
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Nombre de carta requerido.' });
  }

  const cardName = name.trim();
  const cardNumber = (number || '').trim();
  const cardSet = (set || '').trim();

  const [tcgmatchResult, tcgplayerResult, dolarResult] = await Promise.allSettled([
    searchTCGMatch(cardName, cardNumber, cardSet),
    searchTCGPlayer(cardName, cardNumber, cardSet),
    getDolarRate(),
  ]);

  const dolarRate = dolarResult.status === 'fulfilled' ? dolarResult.value : null;

  res.json({
    query: { name: cardName, number: cardNumber, set: cardSet },
    dolarRate,
    tcgmatch: tcgmatchResult.status === 'fulfilled'
      ? tcgmatchResult.value
      : { error: tcgmatchResult.reason?.message, results: [], exactMatch: null },
    tcgplayer: tcgplayerResult.status === 'fulfilled'
      ? tcgplayerResult.value
      : { error: tcgplayerResult.reason?.message, results: [], exactMatch: null },
  });
});

// GET /api/dolar — tipo de cambio USD/CLP actual
app.get('/api/dolar', async (req, res) => {
  try {
    const rate = await getDolarRate();
    if (!rate) return res.status(503).json({ error: 'No se pudo obtener el tipo de cambio.' });
    res.json({ rate, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Comparador PKM corriendo en http://localhost:${PORT}`);
  if (!process.env.API_TCG_KEY) {
    console.warn('[AVISO] API_TCG_KEY no configurada en .env — las búsquedas de cartas fallarán.');
  }
});

process.on('SIGINT',  async () => { await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });
