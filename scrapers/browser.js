const puppeteer = require('puppeteer');

let browser = null;

async function getBrowser() {
  if (browser && browser.connected) return browser;
  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,800',
    ],
  });
  browser.on('disconnected', () => { browser = null; });
  return browser;
}

async function newPage() {
  const b = await getBrowser();
  const page = await b.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8' });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
  // Bloquear recursos innecesarios para acelerar scraping
  await page.setRequestInterception(true);
  page.on('request', req => {
    const type = req.resourceType();
    if (['image', 'media', 'font'].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });
  return page;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

module.exports = { getBrowser, newPage, closeBrowser };
