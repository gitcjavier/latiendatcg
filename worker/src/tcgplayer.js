import { withPage } from "./browser.js";

const BASE_URL = "https://www.tcgplayer.com";

export async function searchTCGPlayer(env, cardName, cardNumber, cardSet) {
  const query = buildQuery(cardName, cardSet);
  const searchUrl = `${BASE_URL}/search/pokemon/product?q=${encodeURIComponent(query)}&view=grid`;

  return await withPage(env, async (page) => {
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 25000 });
    await page.waitForSelector(".product-card__market-price--value", { timeout: 10000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));

    const allResults = await page.evaluate((baseUrl) => {
      const productLinks = [...document.querySelectorAll('a[href*="/product/"]')];

      return productLinks
        .map((link) => {
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

          const setLine =
            lines.find(
              (l) =>
                !l.match(/^\$/) &&
                !l.match(/^#/) &&
                !l.match(/^Market/) &&
                !l.toLowerCase().includes("listing") &&
                !l.toLowerCase().includes("stock") &&
                l.length > 5,
            ) || "";

          const textNumberMatch = (link.innerText || "").match(/#([A-Z]{0,3}\d+)\/[A-Z]{0,3}\d+/);
          const number = altNumber || (textNumberMatch ? textNumberMatch[1] : "");

          const rarityLine = lines.find((l) => l.match(/Ultra Rare|Rare Holo|Common|Uncommon|Promo/i)) || "";
          const rarity = rarityLine ? rarityLine.split(",")[0].trim() : "";

          const outOfStock = link.textContent.toLowerCase().includes("out of stock");

          return {
            name,
            set: setLine,
            number,
            rarity,
            price,
            marketPrice,
            listingPrice,
            currency: "USD",
            condition: "Near Mint",
            inStock: !outOfStock,
            url: link.href,
            imageUrl: img?.src || "",
          };
        })
        .filter((c) => c.name && (c.marketPrice > 0 || c.listingPrice > 0));
    }, BASE_URL);

    const normStr = (s) => s.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();

    const normTarget = normStr(cardName);
    const byName = allResults.filter((r) => normStr(r.name) === normTarget);
    const targetWords = normTarget.split(" ").filter((w) => w.length > 2);
    const byPartial =
      byName.length > 0
        ? byName
        : allResults.filter((r) => {
            const rName = normStr(r.name);
            return targetWords.every((w) => rName.includes(w));
          });

    const normNum = cardNumber ? String(cardNumber).replace(/^0+/, "") : "";
    let results;
    if (normNum && byPartial.some((r) => (r.number || "").replace(/^0+/, "") === normNum)) {
      const exact = byPartial.filter((r) => (r.number || "").replace(/^0+/, "") === normNum);
      const others = byPartial.filter((r) => (r.number || "").replace(/^0+/, "") !== normNum);
      results = [...exact, ...others];
    } else {
      results = byPartial;
    }

    const exactMatch = findExactCard(results, cardName, cardNumber, cardSet);

    return {
      source: "tcgplayer",
      currency: "USD",
      results,
      exactMatch,
      searchUrl,
    };
  });
}

function buildQuery(name, cardSet) {
  if (cardSet) return `${name} ${cardSet}`;
  return name;
}

function findExactCard(results, cardName, cardNumber, cardSet) {
  if (!results.length) return null;
  const normStr = (s) => s.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
  const normName = normStr(cardName);
  const normNum = cardNumber ? String(cardNumber).replace(/^0+/, "") : "";
  const normSet = cardSet ? cardSet.toLowerCase() : "";

  if (normNum) {
    const m = results.find((r) => {
      const rNum = (r.number || "").replace(/^0+/, "");
      return normStr(r.name).includes(normName) && rNum === normNum;
    });
    if (m) return m;
  }

  if (normSet) {
    const setWords = normSet.split(" ").slice(0, 2).join(" ");
    const m = results.find(
      (r) => normStr(r.name).includes(normName) && r.set.toLowerCase().includes(setWords),
    );
    if (m) return m;
  }

  return results.find((r) => normStr(r.name).includes(normName)) || null;
}
