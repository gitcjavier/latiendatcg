# Worker de scraping — `pkm-prices-worker`

Cloudflare Worker que expone **únicamente** `/api/prices`. Hace scraping de TCGMatch.cl y TCGPlayer.com usando **Browser Rendering** vía `@cloudflare/puppeteer`. Se ejecuta en edge, sin cold starts grandes.

## Endpoints

- `GET /api/prices?name=<carta>&number=<n>&set=<set>` — devuelve resultados de ambas tiendas.
- `GET /healthz` — health check.

## Deploy a Cloudflare

Requisitos:
- Cuenta de Cloudflare (plan Workers Free funciona, pero **Browser Rendering** tiene su propio tier: free = 10 min/día, 3 concurrent. Para uso normal conviene Workers Paid $5/mes que incluye 10h browser/mes).
- `wrangler` instalado: viene en `devDependencies` de este worker.

```bash
cd worker
pnpm install
# Login interactivo (una vez)
pnpm wrangler login
# Configura el origen permitido del frontend (Netlify) como variable
pnpm wrangler secret put ALLOWED_ORIGIN  # ej: https://pkm-prices.netlify.app
# Deploy
pnpm deploy
```

Wrangler te dará una URL tipo `https://pkm-prices-worker.<tu-subdomain>.workers.dev`. Esa va en la env `PRICES_BACKEND_URL` del frontend.

## Local

```bash
cd worker
pnpm install
pnpm dev   # http://localhost:8787
```

> Para probar Browser Rendering localmente Wrangler usa un browser remoto del plan de Cloudflare. Necesitas estar logueado.

## Conectar el frontend

En el sitio Astro (Netlify), define:

```
PRICES_BACKEND_URL=https://pkm-prices-worker.<subdomain>.workers.dev
```

`src/pages/api/prices.js` la usa para hacer proxy hacia este Worker.

## Costos

- **Workers Free** ($0/mes): 100k requests/día. Browser Rendering free: 10 min/día.
- **Workers Paid** ($5/mes): 10 millones de requests + 10h browser/mes. $0.09/h browser extra.

Cada llamada al Worker abre ~4 páginas en TCGMatch (≈10-15s total), entonces 10h ≈ 2.500-3.000 búsquedas/mes.
