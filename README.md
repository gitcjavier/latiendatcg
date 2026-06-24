# 🎴 PKM Prices

> **Comparador de precios de cartas Pokémon TCG en Chile.**
> Encuentra al instante el mejor precio de cada carta en TCGMatch y TCGPlayer, explora ediciones del formato estándar, y descubre **preventas y productos sellados** (ETBs, Booster Boxes, Bundles…) entre tiendas chilenas — todo en una sola web rápida, limpia y editorial.

---

## ✨ Qué puedes hacer

### 🔍 Buscar cartas
- Busca por nombre (`Charizard ex`, `Mew V`, `M Absol`…) y obtén el listado de variantes con precio TCGPlayer **al instante** en cada card.
- Pincha una carta y abre un modal con:
  - **TCGMatch**: precios reales en **Inglés y Español** por separado (precios distintos según idioma).
  - **TCGPlayer**: precio "market" en USD + conversión a CLP del día.
  - Banner "Mejor Precio" con la mejor opción disponible.
  - Lista de mejores listados ordenados.

### 📚 Ediciones
- Catálogo completo del **formato estándar** (37+ sets) con logos oficiales.
- Sección de **próximas ediciones** anunciadas (Pitch Black, etc.).
- Entra a una edición y navega todas sus cartas con paginación y orden de colección.

### 📦 Productos
- Busca **sellados** entre tiendas chilenas: Collector Center, Updown, HunterCard, Tienda Eternia (y más en camino).
- **Filtros**: por edición, por tipo de producto (ETB, Booster Box, Booster Bundle, Premium Collection, Tin, Sobre) y por tienda.
- **Toggle "Solo con stock"** — esconde los preventas que aún no tienen unidades.
- **Orden por precio**: menor → mayor o mayor → menor.
- Click en producto → te lleva directo a la tienda.

### 💱 Dólar
- Tipo de cambio USD/CLP actualizado desde mindicador.cl en el header.

---

## 🏗 Stack

| Capa | Tecnología |
|---|---|
| Frontend | **Astro 5** (SSR) + **Tailwind CSS 4** + TypeScript |
| Hosting frontend | **Netlify** (`@astrojs/netlify`) |
| Scraping en edge | **Cloudflare Worker** con `@cloudflare/puppeteer` |
| Package manager | **pnpm** |
| Datos de cartas | [pokemontcg.io](https://pokemontcg.io) (gratuita, devuelve precios TCGPlayer) |
| Tipo de cambio | [mindicador.cl](https://mindicador.cl) |
| Preventas | APIs públicas (Shopify products.json, WooCommerce Store API) |
| Scraping | Puppeteer en Cloudflare Browser Rendering (TCGMatch.cl, TCGPlayer.com) |

---

## 📁 Estructura

```
.
├── src/
│   ├── pages/
│   │   ├── index.astro            # Buscar
│   │   ├── ediciones.astro        # Ediciones (próximas + estándar)
│   │   ├── ediciones/[id].astro   # Detalle de una edición
│   │   ├── productos.astro        # Productos sellados con filtros
│   │   └── api/                   # /cards /sets /dolar /upcoming /productos /prices
│   ├── components/                # Header, Tabs, CardItem, CardDetailModal…
│   ├── lib/                       # pokemontcg, dolar, preventas (axios-only)
│   ├── data/upcoming.json         # Próximas ediciones curadas a mano
│   └── styles/global.css          # Tailwind 4 + design tokens
├── worker/                        # Cloudflare Worker para scraping de precios
├── scripts/local-prices-server.mjs # Server local para probar /api/prices sin Worker
└── astro.config.mjs
```

---

## 🚀 Desarrollo local

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Abre **http://localhost:4321**.

> Si quieres también el scraping de precios localmente sin desplegar el Worker:
>
> ```bash
> node scripts/local-prices-server.mjs   # http://localhost:3001
> # y en .env:
> PRICES_BACKEND_URL=http://localhost:3001
> ```

### Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `POKEMONTCG_KEY` | opcional | Sube el rate limit de pokemontcg.io. [Obtén una aquí](https://pokemontcg.io). |
| `PRICES_BACKEND_URL` | sí (prod) | URL del Cloudflare Worker. Sin esto `/api/prices` devuelve 503. |

---

## ☁️ Deploy en Netlify

1. **Sube el repo a GitHub** (ya está hecho).
2. En [Netlify](https://app.netlify.com): **Add new site → Import an existing project → GitHub** y selecciona este repo.
3. Netlify detecta Astro automáticamente:
   - Build command: `pnpm build`
   - Publish directory: `dist`
4. En **Site settings → Environment variables**, agrega:
   - `PRICES_BACKEND_URL` = `https://pkm-prices-worker.<tu-subdominio>.workers.dev`
   - `POKEMONTCG_KEY` = (opcional)
5. **Deploy site**. En 1-2 min tendrás tu sitio en `https://<nombre>.netlify.app`.

> **¿Sin Worker desplegado todavía?** El frontend funciona igual: Buscar, Ediciones y Productos andan al 100%. Solo el modal de precios mostrará 503 hasta que conectes el Worker.

---

## ⚡ Deploy del Cloudflare Worker (scraping)

```bash
cd worker
pnpm install
pnpm wrangler login
pnpm deploy
```

Ver [worker/README.md](worker/README.md) para detalles (Browser Rendering binding, cron, etc.).

Una vez desplegado, copia la URL (`https://pkm-prices-worker.<sub>.workers.dev`) a la variable `PRICES_BACKEND_URL` de Netlify.

---

## 📊 Endpoints

| Endpoint | Descripción |
|---|---|
| `GET /api/cards?q=charizard` | Busca cartas por nombre (con precios TCGP) |
| `GET /api/sets` | Sets del formato estándar |
| `GET /api/sets/:id/cards?page=1` | Cartas de un set, paginado |
| `GET /api/dolar` | Tipo de cambio USD/CLP |
| `GET /api/upcoming` | Próximas ediciones curadas |
| `GET /api/productos?edition=Pitch%20Black&types=etb,bundle&stock=1&sort=desc` | Productos sellados con filtros |
| `GET /api/prices?id=…&name=…&number=…&set=…` | Scraping TCGMatch + TCGPlayer (proxy al Worker) |

---

## 🎨 Diseño

Look editorial: fondo blanco, tipografía **Fraunces** serif para headings, palabra clave en azul `#1d4ed8`, palette neutra con grises cálidos. Tabs con contadores, cards con sombras suaves, modal blanco con toques azules.

---

## 📝 Licencia

Proyecto personal. Las imágenes y nombres de cartas son propiedad de **The Pokémon Company / Nintendo / Creatures**.
