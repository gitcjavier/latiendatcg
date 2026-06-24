// Helper para abrir páginas a través del binding BROWSER de Cloudflare.
// Cada llamada lanza un browser nuevo (Browser Rendering los mata al terminar el request).

import puppeteer from "@cloudflare/puppeteer";

export async function withPage(env, fn) {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "Accept-Language": "es-CL,es;q=0.9,en;q=0.8" });
    // Bloquear assets pesados que no necesitamos (imagenes y fonts) para velocidad
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const t = req.resourceType();
      if (t === "image" || t === "media" || t === "font") return req.abort();
      req.continue();
    });
    return await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}
