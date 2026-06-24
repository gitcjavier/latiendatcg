# ADR-0001: Estrategia de caché para scraping de precios

- **Estado**: Accepted
- **Fecha**: 2026-06-24
- **Decidido por**: Javier (owner) + asistente

## Contexto

El endpoint `/api/prices` del Cloudflare Worker scrapea **TCGMatch.cl** y
**TCGPlayer.com** usando Browser Rendering (Puppeteer en edge) para resolver
precios de cartas en tiempo real.

Cloudflare **Browser Rendering free tier** impone tres límites:

| Límite | Free tier |
|---|---|
| Browser time total | 10 min/día |
| Browsers concurrentes | 2 |
| **Lanzamientos por minuto** | **3** |

Cada consulta al modal de detalle lanza **2 browsers** (uno por sitio, ya
serializados — ver `worker/src/index.js`). Con sólo 3 launches/minuto en el
plan free, **una sola consulta consume el 67% del cupo del minuto**. Bajo
cualquier tráfico real el endpoint devuelve **429 Rate limit exceeded**.

Probado en producción:
```
GET https://latiendatcg.netlify.app/api/prices?name=Charizard%20ex&...
→ tcgmatch: 429, tcgplayer: 429
```

Pasar a **Workers Paid ($5 USD/mes)** elimina el rate limit del minuto y sube
el browser time a 10 h/día, pero introduce un costo recurrente que no se
justifica para un proyecto en fase inicial sin métricas de uso reales.

## Decisión

Adoptamos una estrategia en **dos fases**:

### Fase 1 (ahora) — Caché agresivo en edge

- Cachear cada respuesta de `/api/prices` usando el **Cloudflare Cache API**
  built-in (`caches.default`) con el URL completo como cache key.
- **TTL: 6 horas**. Los precios de cartas sellado/singles se mueven lento
  comparado con la frecuencia esperada de consultas del modal.
- Sólo se cachean respuestas **válidas** (al menos uno de los dos scrapers
  trajo `exactMatch` o `results.length > 0`). Las respuestas con error de
  ambos lados **no** se cachean — así un 429 momentáneo no contamina el caché.
- La respuesta lleva header `Cache-Control: public, max-age=21600` para que
  proxies intermedios también colaboren.

### Fase 2 (cuando crezca el tráfico) — Workers Paid

Activar el plan Workers Paid de Cloudflare ($5 USD/mes) cuando se observe
cualquiera de estas señales:

- Las métricas del Worker muestran `>3 launches/min sostenidos`.
- La tasa de hits del caché baja consistentemente del 70% (mucha cardinalidad
  de queries únicas).
- El sitio empieza a recibir tráfico orgánico medible (no sólo tester
  personal).

## Alternativas consideradas

### A. Pagar Workers Paid de entrada
- **Pro**: solución definitiva, sin lógica extra.
- **Contra**: $60 USD/año por algo que no sabemos si va a tener tráfico.
  Descartada en Fase 1; reservada para Fase 2.

### B. Cachear en KV (Cloudflare Workers KV)
- **Pro**: caché global compartida entre regiones, más predecible que Cache API.
- **Contra**: requiere crear namespace, configurar binding en `wrangler.toml`,
  serializar/deserializar manualmente. Más superficie de error y deployment.
  Para el tráfico esperado (modal abierto bajo demanda), Cache API per-región
  basta.

### C. Pre-scrapear top-N cartas en un cron
- **Pro**: la primera consulta de las cartas populares siempre es instantánea.
- **Contra**: no sabemos qué cartas son "populares" sin telemetría. Y
  consumiría el cupo de 10 min/día sin tener garantía de que esas consultas
  precalculadas se usen.

### D. Pasar a otra alternativa de scraping (Browserless.io, ScrapingBee, etc.)
- **Pro**: sin límites de Cloudflare.
- **Contra**: cambia el modelo de hosting, introduce un tercero adicional con
  su propia pricing y posibilidad de cortarnos. Sobre-ingeniería para esta fase.

## Consecuencias

### Positivas
- El endpoint **deja de devolver 429** para cartas ya consultadas en las
  últimas 6 horas — el caso común del modal de detalle.
- **Costo: $0** mientras dure la Fase 1.
- Cache API tiene latencia sub-10 ms en hit — el modal abre casi instantáneo.

### Negativas / costos
- Datos **hasta 6h desfasados**. Aceptable para precios de coleccionables (no
  trading de alta frecuencia).
- Caché Cache API es **per-edge-region**: un usuario en Santiago llena su PoP,
  otro en Miami volverá a scrapear. Para sitio chileno hosteado en Netlify
  esto es aceptable.
- Primera carga de cada carta nueva sigue gastando 2 launches del minuto.

### Riesgos a vigilar
- Si TCGPlayer/TCGMatch cambian su HTML y los scrapers fallan, el caché
  amortigua el problema pero también puede ocultarlo. Mitigado por no cachear
  respuestas con error en ambos lados.
- Si la cardinalidad de queries crece mucho (muchas cartas distintas), la
  tasa de hit baja y volvemos a topar el rate limit. Triggers para revisar
  → Fase 2.

## Plan de revisión

Revisar esta decisión cuando ocurra **cualquiera** de:

1. Métricas del Worker muestran >100 invocaciones/día con cache hit rate <70%.
2. Sitio supera 1.000 visitantes únicos/mes según Netlify Analytics o GA.
3. Usuarios reportan precios desactualizados como problema concreto (no
  hipotético).

En cualquiera de esos casos: activar Workers Paid (Fase 2) y reducir TTL
a 1 h.
