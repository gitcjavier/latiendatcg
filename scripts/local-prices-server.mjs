// Mini-server LOCAL para validar /api/prices end-to-end.
// Usa Puppeteer normal y adapta los scrapers del worker (que esperan binding BROWSER).
// Solo se usa en desarrollo — el worker/ es lo que va a producción.

import http from "node:http";
import puppeteer from "puppeteer";

// Reutilizamos el código de los scrapers del Worker, pero le pasamos un browser
// real en vez del binding env.BROWSER. Para eso adaptamos withPage().
//
// Truco: monkey-patch del módulo browser.js antes de importarlos. Más simple:
// duplicar la lógica acá con la API normal de puppeteer.

const TCGMATCH = "https://www.tcgmatch.cl";
const TCGPLAYER = "https://www.tcgplayer.com";

let _browser;
async function getBrowser() {
  if (_browser && _browser.connected) return _browser;
  _browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  return _browser;
}

async function withPage(fn) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36",
  );
  await page.setExtraHTTPHeaders({ "Accept-Language": "es-CL,es;q=0.9,en;q=0.8" });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const t = req.resourceType();
    if (t === "image" || t === "media" || t === "font") return req.abort();
    req.continue();
  });
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

// ───────── TCGMatch ─────────
async function searchTCGMatch(cardName, cardNumber, cardSet) {
  const query = cardNumber ? `${cardName} ${String(cardNumber).padStart(3, "0")}` : cardName;
  const searchUrl = `${TCGMATCH}/cartas/busqueda/tcg=pokemon&q=${encodeURIComponent(query)}`;

  return await withPage(async (page) => {
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 25000 });
    await page.waitForSelector("p.text-2xl", { timeout: 10000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));

    const results = await page.evaluate((baseUrl) => {
      const cards = document.querySelectorAll(".group.relative.rounded-xl.overflow-hidden.cursor-pointer");
      return [...cards]
        .map((card) => {
          const priceEl = card.querySelector("p.text-2xl");
          const price = priceEl ? parseInt(priceEl.textContent.replace(/\D/g, ""), 10) : 0;
          const marketEl = card.querySelector("span.text-primary-700, span.font-medium.text-primary-700");
          const marketPrice = marketEl ? parseInt(marketEl.textContent.replace(/\D/g, ""), 10) : 0;
          const texts = [...card.querySelectorAll("p, span, h2, h3")]
            .map((el) => el.textContent.trim())
            .filter((t) => t.length > 1 && t.length < 100 && !t.match(/^\$[\d\.]+$/) && t !== "");
          const name = texts[0] || "";
          const set = texts[1] || "";
          const number = texts.find((t) => t.match(/^#\d+\/\d+$/)) || "";
          const fromText = [...card.querySelectorAll("p, span")].find((el) =>
            el.textContent.match(/\d+\s*desde/i),
          );
          const stock = fromText ? parseInt((fromText.textContent.match(/(\d+)/) || [])[1] || "0", 10) : 1;
          const link = card.querySelector("a") || card.closest("a");
          const img = card.querySelector("img");
          return {
            name, set, number, price, marketPrice, stock, currency: "CLP",
            url: link?.href || baseUrl, imageUrl: img?.src || "",
          };
        })
        .filter((c) => {
          if (!c.name || c.price <= 0) return false;
          const setLower = (c.set || "").toLowerCase();
          if (setLower.includes("japon")) return false;
          if (/[぀-ヿ一-鿿]/.test(c.set)) return false;
          return true;
        });
    }, TCGMATCH);

    // Match cards
    const normStr = (s) => s.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
    const normName = normStr(cardName);
    const normNum = cardNumber ? String(cardNumber).replace(/^0+/, "") : "";
    let matches = [];
    if (normNum) {
      matches = results.filter((r) => {
        const rNum = (r.number || "").replace(/^#?0+/, "").split("/")[0];
        return normStr(r.name).includes(normName) && rNum === normNum;
      });
    }
    if (!matches.length) matches = results.filter((r) => normStr(r.name).includes(normName));
    matches.sort((a, b) => (a.price || 0) - (b.price || 0));

    const exactMatch = matches[0] || null;

    // Idiomas en hasta 3 URLs
    if (matches.length > 0) {
      let aggIngles = null, aggEspanol = null;
      for (const m of matches.slice(0, 3)) {
        if (!m.url || m.url === TCGMATCH) continue;
        const lang = await getListingsByLanguage(m.url);
        if (!lang) continue;
        if (lang.ingles) {
          if (!aggIngles) aggIngles = { ...lang.ingles };
          else {
            if (lang.ingles.minPrice < aggIngles.minPrice) aggIngles.minPrice = lang.ingles.minPrice;
            aggIngles.stock += lang.ingles.stock;
          }
        }
        if (lang.espanol) {
          if (!aggEspanol) aggEspanol = { ...lang.espanol };
          else {
            if (lang.espanol.minPrice < aggEspanol.minPrice) aggEspanol.minPrice = lang.espanol.minPrice;
            aggEspanol.stock += lang.espanol.stock;
          }
        }
      }
      if (exactMatch) {
        exactMatch.ingles = aggIngles || null;
        exactMatch.espanol = aggEspanol || null;
        const primary = aggIngles || aggEspanol;
        if (primary) {
          exactMatch.price = primary.minPrice;
          exactMatch.stock = primary.stock;
        }
      }
    }

    return { source: "tcgmatch", currency: "CLP", results, exactMatch, searchUrl };
  });
}

async function getListingsByLanguage(cardUrl) {
  return await withPage(async (page) => {
    try {
      await page.goto(cardUrl, { waitUntil: "networkidle2", timeout: 20000 });
      await new Promise((r) => setTimeout(r, 2500));
      const markedBtn = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button, a, [role="button"]')].find((el) =>
          /ver otros/i.test((el.innerText || "").trim()),
        );
        if (btn) { btn.setAttribute("data-tcg-expand", "1"); return true; }
        return false;
      });
      if (markedBtn) {
        try {
          await page.click('[data-tcg-expand="1"]');
          await page.waitForFunction(() =>
            [...document.querySelectorAll("span")].filter((el) =>
              ["Japonés", "Inglés", "Español"].includes(el.textContent.trim()),
            ).length > 1, { timeout: 5000 },
          ).catch(() => {});
          await new Promise((r) => setTimeout(r, 800));
        } catch {}
      }
      return await page.evaluate(() => {
        const LANGS = ["Japonés", "Inglés", "Español"];
        const langBadges = [...document.querySelectorAll("span")].filter((el) =>
          LANGS.includes(el.textContent.trim()),
        );
        const listings = [];
        for (const badge of langBadges) {
          const lang = badge.textContent.trim();
          let container = badge.parentElement;
          for (let i = 0; i < 10; i++) {
            if (!container) break;
            const text = container.innerText || "";
            const match = text.match(/\$\s*([\d.]+)/);
            if (match && text.length < 800) {
              const price = parseInt(match[1].replace(/\./g, ""), 10);
              if (price > 0) { listings.push({ price, lang }); break; }
            }
            container = container.parentElement;
          }
        }
        const seen = new Set();
        const unique = listings.filter((l) => {
          const k = `${l.price}-${l.lang}`;
          if (seen.has(k)) return false;
          seen.add(k); return true;
        });
        const byLang = (lang) => {
          const items = unique.filter((l) => l.lang === lang);
          return items.length
            ? { minPrice: Math.min(...items.map((l) => l.price)), stock: items.length }
            : null;
        };
        return { ingles: byLang("Inglés"), espanol: byLang("Español") };
      });
    } catch {
      return null;
    }
  });
}

// ───────── TCGPlayer ─────────
async function searchTCGPlayer(cardName, cardNumber, cardSet) {
  const query = cardSet ? `${cardName} ${cardSet}` : cardName;
  const searchUrl = `${TCGPLAYER}/search/pokemon/product?q=${encodeURIComponent(query)}&view=grid`;

  return await withPage(async (page) => {
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 25000 });
    await page.waitForSelector(".product-card__market-price--value", { timeout: 10000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));

    const all = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href*="/product/"]')];
      return links.map((link) => {
        const img = link.querySelector("img");
        const altRaw = img?.alt?.trim() || "";
        const name = altRaw.replace(/\s*-\s*[A-Z]{0,3}\d+\/[A-Z]{0,3}\d+\s*$/, "").trim();
        const altNumberMatch = altRaw.match(/\b([A-Z]{0,3}\d+)\/[A-Z]{0,3}\d+/);
        const altNumber = altNumberMatch ? altNumberMatch[1].replace(/^0+/, "") : "";
        const marketEl = link.querySelector(".product-card__market-price--value");
        const marketPrice = marketEl ? parseFloat(marketEl.textContent.replace(/[^0-9.]/g, "")) : 0;
        const listingEl = link.querySelector(".inventory__price-with-shipping, .inventory__price");
        const listingPrice = listingEl ? parseFloat(listingEl.textContent.replace(/[^0-9.]/g, "")) : 0;
        const price = listingPrice || marketPrice;
        const lines = (link.innerText || "").split("\n").map((l) => l.trim()).filter((l) => l.length > 1);
        const setLine = lines.find((l) =>
          !l.match(/^\$/) && !l.match(/^#/) && !l.match(/^Market/) &&
          !l.toLowerCase().includes("listing") && !l.toLowerCase().includes("stock") && l.length > 5) || "";
        const textNumberMatch = (link.innerText || "").match(/#([A-Z]{0,3}\d+)\/[A-Z]{0,3}\d+/);
        const number = altNumber || (textNumberMatch ? textNumberMatch[1] : "");
        const rarityLine = lines.find((l) => l.match(/Ultra Rare|Rare Holo|Common|Uncommon|Promo/i)) || "";
        const rarity = rarityLine ? rarityLine.split(",")[0].trim() : "";
        const outOfStock = link.textContent.toLowerCase().includes("out of stock");
        return { name, set: setLine, number, rarity, price, marketPrice, listingPrice,
          currency: "USD", condition: "Near Mint", inStock: !outOfStock, url: link.href, imageUrl: img?.src || "" };
      }).filter((c) => c.name && (c.marketPrice > 0 || c.listingPrice > 0));
    });

    const normStr = (s) => s.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
    const normName = normStr(cardName);
    const targetWords = normName.split(" ").filter((w) => w.length > 2);
    const byName = all.filter((r) => normStr(r.name) === normName);
    const byPartial = byName.length > 0 ? byName : all.filter((r) => targetWords.every((w) => normStr(r.name).includes(w)));
    const normNum = cardNumber ? String(cardNumber).replace(/^0+/, "") : "";
    let results;
    if (normNum && byPartial.some((r) => (r.number || "").replace(/^0+/, "") === normNum)) {
      const exact = byPartial.filter((r) => (r.number || "").replace(/^0+/, "") === normNum);
      const others = byPartial.filter((r) => (r.number || "").replace(/^0+/, "") !== normNum);
      results = [...exact, ...others];
    } else {
      results = byPartial;
    }
    const exactMatch = results[0] || null;
    return { source: "tcgplayer", currency: "USD", results, exactMatch, searchUrl };
  });
}

async function getDolarRate() {
  try {
    const r = await fetch("https://mindicador.cl/api/dolar", { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return j?.serie?.[0]?.valor || null;
  } catch { return null; }
}

// ───────── Server ─────────
const PORT = 3001;
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (url.pathname !== "/api/prices") {
    res.writeHead(404).end();
    return;
  }
  const name = url.searchParams.get("name")?.trim();
  const number = (url.searchParams.get("number") || "").trim();
  const set = (url.searchParams.get("set") || "").trim();
  if (!name) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "name required" }));
  }
  console.log(`[prices] name="${name}" number="${number}" set="${set}"`);
  try {
    const [tcgmatchResult, tcgplayerResult, dolarRate] = await Promise.allSettled([
      searchTCGMatch(name, number, set),
      searchTCGPlayer(name, number, set),
      getDolarRate(),
    ]);
    const payload = {
      query: { name, number, set },
      dolarRate: dolarRate.status === "fulfilled" ? dolarRate.value : null,
      tcgmatch: tcgmatchResult.status === "fulfilled"
        ? tcgmatchResult.value
        : { error: tcgmatchResult.reason?.message, results: [], exactMatch: null },
      tcgplayer: tcgplayerResult.status === "fulfilled"
        ? tcgplayerResult.value
        : { error: tcgplayerResult.reason?.message, results: [], exactMatch: null },
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log(`local-prices-server escuchando en http://localhost:${PORT}`);
});

process.on("SIGINT", async () => {
  if (_browser) await _browser.close().catch(() => {});
  process.exit(0);
});
