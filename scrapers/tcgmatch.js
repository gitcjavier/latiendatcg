const { newPage } = require('./browser');

const BASE_URL = 'https://www.tcgmatch.cl';

async function searchTCGMatch(cardName, cardNumber, cardSet) {
  // Búsqueda precisa: nombre + número de carta para encontrar la misma carta
  const query = buildQuery(cardName, cardNumber);
  const searchUrl = `${BASE_URL}/cartas/busqueda/tcg=pokemon&q=${encodeURIComponent(query)}`;

  const page = await newPage();
  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await page.waitForSelector('p.text-2xl', { timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));

    const results = await page.evaluate((baseUrl) => {
      const cards = document.querySelectorAll('.group.relative.rounded-xl.overflow-hidden.cursor-pointer');
      return [...cards].map(card => {
        // Precio más bajo de listado activo
        const priceEl = card.querySelector('p.text-2xl');
        const price = priceEl ? parseInt(priceEl.textContent.replace(/\D/g, ''), 10) : 0;

        // Precio de mercado
        const marketEl = card.querySelector('span.text-primary-700, span.font-medium.text-primary-700');
        const marketPrice = marketEl ? parseInt(marketEl.textContent.replace(/\D/g, ''), 10) : 0;

        // Todos los textos del card para extraer nombre, set, número
        const texts = [...card.querySelectorAll('p, span, h2, h3')]
          .map(el => el.textContent.trim())
          .filter(t => t.length > 1 && t.length < 100 && !t.match(/^\$[\d\.]+$/) && t !== '');

        const name = texts[0] || '';
        const set = texts[1] || '';
        const number = texts.find(t => t.match(/^#\d+\/\d+$/)) || '';

        // Vendedores disponibles
        const fromText = [...card.querySelectorAll('p, span')]
          .find(el => el.textContent.match(/\d+\s*desde/i));
        const stock = fromText ? parseInt((fromText.textContent.match(/(\d+)/) || [])[1] || '0', 10) : 1;

        const link = card.querySelector('a') || card.closest('a');
        const img = card.querySelector('img');

        return {
          name,
          set,
          number,
          price,
          marketPrice,
          stock,
          currency: 'CLP',
          url: link?.href || baseUrl,
          imageUrl: img?.src || '',
        };
      }).filter(c => {
        if (!c.name || c.price <= 0) return false;
        // Excluir cartas japonesas (set contiene "japon" o caracteres japoneses)
        const setLower = (c.set || '').toLowerCase();
        if (setLower.includes('japon')) return false;
        if (/[぀-ヿ一-鿿]/.test(c.set)) return false;
        return true;
      });
    }, BASE_URL);

    // Encontrar TODAS las cartas que coinciden con el nombre/número buscado
    const matchingCards = findMatchingCards(results, cardName, cardNumber, cardSet);
    const exactMatch = matchingCards[0] || null;

    // Visitar hasta 4 URLs coincidentes y agregar precios por idioma
    if (matchingCards.length > 0) {
      let aggregatedIngles  = null;
      let aggregatedEspanol = null;

      for (const match of matchingCards.slice(0, 4)) {
        if (!match.url || match.url === BASE_URL) continue;
        const langData = await getListingsByLanguage(match.url);
        if (!langData) continue;

        if (langData.ingles) {
          if (!aggregatedIngles) {
            aggregatedIngles = { ...langData.ingles };
          } else {
            // Conservar el precio mínimo y sumar stock
            if (langData.ingles.minPrice < aggregatedIngles.minPrice) {
              aggregatedIngles.minPrice = langData.ingles.minPrice;
            }
            aggregatedIngles.stock += langData.ingles.stock;
          }
        }

        if (langData.espanol) {
          if (!aggregatedEspanol) {
            aggregatedEspanol = { ...langData.espanol };
          } else {
            if (langData.espanol.minPrice < aggregatedEspanol.minPrice) {
              aggregatedEspanol.minPrice = langData.espanol.minPrice;
            }
            aggregatedEspanol.stock += langData.espanol.stock;
          }
        }
      }

      if (exactMatch) {
        exactMatch.ingles  = aggregatedIngles  || null;
        exactMatch.espanol = aggregatedEspanol || null;

        // Precio primario = inglés; si no hay inglés, español
        const primary = aggregatedIngles || aggregatedEspanol;
        if (primary) {
          exactMatch.price = primary.minPrice;
          exactMatch.stock = primary.stock;
        }

        const idx = results.indexOf(exactMatch);
        if (idx >= 0) results[idx] = exactMatch;
      }
    }

    return {
      source: 'tcgmatch',
      currency: 'CLP',
      results,
      exactMatch,
      searchUrl,
    };
  } finally {
    await page.close();
  }
}

async function getListingsByLanguage(cardUrl) {
  const page = await newPage();
  try {
    await page.goto(cardUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2500)); // necesario para que cargue el botón "Ver otros"

    // Marcar el botón "Ver otros vendedores" para poder clickearlo con Puppeteer
    const markedBtn = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button, a, [role="button"]')]
        .find(el => /ver otros/i.test((el.innerText || '').trim()));
      if (btn) { btn.setAttribute('data-tcg-expand', '1'); return true; }
      return false;
    });

    if (markedBtn) {
      try {
        await page.click('[data-tcg-expand="1"]');
        // Esperar a que aparezcan más badges de idioma (carga dinámica)
        await page.waitForFunction(() =>
          [...document.querySelectorAll('span')]
            .filter(el => ['Japonés','Inglés','Español'].includes(el.textContent.trim()))
            .length > 1,
          { timeout: 5000 }
        ).catch(() => {});
        await new Promise(r => setTimeout(r, 800));
      } catch (_) {}
    }

    const data = await page.evaluate(() => {
      const LANGS = ['Japonés', 'Inglés', 'Español'];
      const langBadges = [...document.querySelectorAll('span')]
        .filter(el => LANGS.includes(el.textContent.trim()));

      console.log('[tcgmatch] badges encontrados:', langBadges.map(b => b.textContent.trim()));

      const listings = [];
      for (const badge of langBadges) {
        const lang        = badge.textContent.trim();
        const isJapanese  = lang === 'Japonés';
        let container     = badge.parentElement;

        for (let i = 0; i < 10; i++) {
          if (!container) break;
          const text  = container.innerText || '';
          const match = text.match(/\$\s*([\d.]+)/);
          if (match && text.length < 800) {
            const price = parseInt(match[1].replace(/\./g, ''), 10);
            if (price > 0) { listings.push({ price, lang, isJapanese }); break; }
          }
          container = container.parentElement;
        }
      }

      console.log('[tcgmatch] listings extraídos:', listings);

      const seen   = new Set();
      const unique = listings.filter(l => {
        const k = `${l.price}-${l.lang}`;
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });

      const byLang = (lang) => {
        const items = unique.filter(l => l.lang === lang);
        return items.length
          ? { minPrice: Math.min(...items.map(l => l.price)), stock: items.length }
          : null;
      };
      return { ingles: byLang('Inglés'), espanol: byLang('Español') };
    });

    console.log('[tcgmatch] getListingsByLanguage resultado:', data, 'url:', cardUrl);
    return data;
  } catch (err) {
    console.error('[tcgmatch] getListingsByLanguage error:', err.message);
    return null;
  } finally {
    await page.close();
  }
}

function buildQuery(name, number) {
  if (!number) return name;
  // Normalizar número: "25" → "025" si es < 3 dígitos, o pasar directo
  const numNorm = number.padStart(3, '0');
  return `${name} ${numNorm}`;
}

/**
 * Retorna TODAS las cartas que coinciden (por nombre, número y set),
 * ordenadas por precio ascendente.
 */
function findMatchingCards(results, cardName, cardNumber, cardSet) {
  if (!results.length) return [];
  const normStr = s => s.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  const normName = normStr(cardName);
  const normNum  = cardNumber ? cardNumber.replace(/^0+/, '') : '';
  const normSet  = cardSet ? normStr(cardSet) : '';

  let matches = [];

  // 1. Nombre + número exacto
  if (normNum) {
    matches = results.filter(r => {
      const rNum = (r.number || '').replace(/^#?0+/, '').split('/')[0];
      return normStr(r.name).includes(normName) && rNum === normNum;
    });
  }

  // 2. Nombre + primera palabra del set
  if (!matches.length && normSet) {
    const setWord = normSet.split(' ')[0];
    matches = results.filter(r =>
      normStr(r.name).includes(normName) &&
      normStr(r.set).includes(setWord)
    );
  }

  // 3. Solo nombre
  if (!matches.length) {
    matches = results.filter(r => normStr(r.name).includes(normName));
  }

  // Ordenar por precio ascendente para que el más barato sea primero
  return matches.sort((a, b) => (a.price || 0) - (b.price || 0));
}

// Mantener compatibilidad: findExactCard retorna el primero
function findExactCard(results, cardName, cardNumber, cardSet) {
  return findMatchingCards(results, cardName, cardNumber, cardSet)[0] || null;
}

module.exports = { searchTCGMatch };
