# ADR-0002: Migrar a la API pública de TCGMatch (descontinuar Puppeteer)

- **Estado**: Accepted
- **Fecha**: 2026-06-25
- **Decidido por**: Javier + asistente

## Contexto

[[0001-caching-strategy-precios]] adoptó caché de 6h para mitigar el rate limit
de Cloudflare Browser Rendering (3 launches/min, 10 min/día en free tier),
con la idea de pasar a Workers Paid si el tráfico crecía.

Investigando alternativas más estables, descubrimos que **tcgmatch.cl expone
su API JSON públicamente** en `api.tcgmatch.cl`. El frontend Next.js de la
tienda llama a estos endpoints en cleartext sin autenticación ni rate limit
visible:

| Endpoint | Devuelve |
|---|---|
| `GET /catalog/search?tcg=pokemon&q=<query>` | Lista de cartas con `cardCode`, `setName`, `lowestPrice`, `marketPrice` |
| `GET /catalog/{id}` | Detalle: precios TCGMatch (low/mid/high/market, countSellers) **y precios TCGPlayer** (low/mid/high/market, URL al producto) |
| `GET /products/catalog/{id}?inStock=true` | Listings en venta con `language` ("spanish"/"english"), `price`, `status` (condición), `quantity`, `user.username` |

Confirmado en producción: las llamadas funcionan con headers normales de
browser (User-Agent + Origin + Referer), responden en <500 ms, devuelven JSON
estructurado.

Esto cambia el escenario por completo:

- **TCGMatch** ya no requiere scraping con Puppeteer. Una llamada HTTP basta.
- **TCGPlayer** tampoco — `/catalog/{id}.markets.tcgplayer.prices` trae los
  mismos low/mid/high/market que el scraping (idénticos a los que devuelve
  pokemontcg.io en `tcgplayer.prices`, porque ambos consumen la misma fuente).
- **El Cloudflare Worker queda sin propósito** para `/api/prices`.

## Decisión

1. **Crear `src/lib/tcgmatch.js`** con `getPricesFromTCGMatch(name, number, set)`
   que orquesta los 3 endpoints y devuelve la misma forma de objeto que el
   Worker producía, para no romper el frontend (`tcgmatch.exactMatch.ingles`,
   `tcgmatch.exactMatch.espanol`, `tcgplayer.exactMatch.price`, etc.).
2. **Reescribir `src/pages/api/prices.js`** para llamar a este módulo
   directamente desde el SSR de Netlify, eliminando el proxy al Worker y
   la dependencia de `PRICES_BACKEND_URL`.
3. **Mantener el Worker disponible pero ocioso** durante un periodo de
   observación. Si la API de tcgmatch.cl cae o cambia de forma incompatible,
   podemos revertir agregando `PRICES_BACKEND_URL` y rollback del endpoint
   `/api/prices`.
4. **Caché en memoria de 30 min** dentro del módulo — más corto que las 6 h
   del Cache API porque ahora es gratis y queremos datos más frescos.
5. **No tocar el caché del Worker (ADR-0001)** — queda como red de
   seguridad si revertimos.

## Alternativas consideradas

### A. Mantener Puppeteer + pagar Workers Paid ($5/mes)
- **Pro**: la solución de ADR-0001 con cero riesgo de cambio externo.
- **Contra**: $60/año por algo que ya se puede hacer gratis. Y Puppeteer
  sigue siendo más frágil que una API JSON (cambios de DOM rompen el
  scraping, mientras que una API estable sólo cambia con un breaking
  change explícito).

### B. Llamar a la API desde el browser (cliente)
- **Pro**: cero infraestructura, latencia mínima.
- **Contra**: expone tcgmatch.cl al tráfico de nuestros usuarios sin nuestro
  control, y CORS de la API podría cerrarse en cualquier momento. SSR proxy
  (lo elegido) permite cachear, agregar y blindar.

### C. Reverse-proxy el Worker para que llame a la API
- **Pro**: cambios mínimos al frontend.
- **Contra**: el Worker no aporta nada en este flujo (no necesitamos browser
  ni edge). Sólo agrega latencia y un punto de falla.

## Consecuencias

### Positivas
- **Sin rate limit, sin costo, sin Browser Rendering.** El plan Workers
  Paid de ADR-0001 ya no se necesita en el horizonte previsible.
- **Datos más ricos**: el endpoint devuelve `condition`, `seller.username`,
  `quantity` por listing. La UI de "Mejores Listados" puede mostrar más
  detalle.
- **Latencia**: ~500 ms vs ~8-15 s del scraping con Puppeteer.
- **Mantenimiento**: scraping con CSS selectors es frágil; un contrato JSON
  estable es más predecible.

### Negativas / costos
- **Dependencia de un endpoint no documentado**. tcgmatch.cl puede:
  - Cerrar la API a CORS o requerir auth (más probable que cambiar el HTML
    porque romper su propio frontend les cuesta más).
  - Modificar el contrato (cambio de nombre de campos, paginación).
  En cualquiera de esos casos el modal pierde precios — pero el fallback a
  `card.tcgpMarket` de pokemontcg.io (TCGP) y la UI graceful degradation
  (ADR-0003 — pendiente, ya implementada en código) mantienen lo demás.
- El Worker queda como código vivo no usado en el path principal.

### Riesgos a vigilar
- **Cambios en `api.tcgmatch.cl`**: monitorear logs de `/api/prices` por
  spikes de 502/500.
- **Cambios de Term of Service**: si tcgmatch.cl publica T&C que prohíban
  uso programático, dejar de usarlo y volver a Workers Paid + scraping.

## Plan de revisión

Revisar esta decisión si:

1. El endpoint comienza a devolver 401/403/429 sostenidamente → volver al
   Worker o reverse-engineer con auth de visitante anónimo.
2. Cambios de contrato rompen el parser → ajustar `pickBest` /
   `buildTcgmatchResult` / `buildTcgplayerResult`.
3. Latencia >2 s p95 → cachear más agresivo o agregar Cache API de Netlify.

Tras 3 meses sin incidentes, evaluar **eliminar definitivamente el Worker**
(`worker/`) para reducir superficie de mantenimiento.
