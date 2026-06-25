# Architecture Decision Records (ADR)

Este directorio guarda las decisiones técnicas importantes del proyecto.
Cada decisión es un archivo Markdown con un número correlativo y formato fijo.

## ¿Qué es una ADR?

Una **Architecture Decision Record** documenta una decisión técnica relevante
junto con el contexto que la justifica y sus consecuencias. Permite que cualquier
persona (o tú mismo en 6 meses) entienda **por qué** se hizo algo de una forma
y no de otra, sin tener que reconstruir el razonamiento desde cero.

Inspirado en el formato propuesto por [Michael Nygard][1].

[1]: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions

## Convenciones

- **Nombre del archivo**: `NNNN-titulo-en-kebab-case.md` (cuatro dígitos con ceros).
- **Inmutabilidad**: una ADR `Accepted` no se reescribe. Si la realidad cambia,
  se crea una nueva ADR que la **supersede** y se actualiza el estado de la vieja
  a `Superseded by ADR-NNNN`.
- **Cuándo escribir una**: cuando la decisión afecta arquitectura, costo,
  seguridad, performance, dependencias externas o flujo de despliegue. Pequeños
  refactors no necesitan ADR.

## Estados

| Estado | Significado |
|---|---|
| `Proposed` | Borrador en discusión, aún no implementado. |
| `Accepted` | Decidida e implementada (o en proceso). |
| `Deprecated` | Ya no aplica, pero todavía influye en el código existente. |
| `Superseded by ADR-NNNN` | Reemplazada por otra ADR posterior. |

## Plantilla

```markdown
# ADR-NNNN: <Título corto en frase>

- **Estado**: Proposed | Accepted | Deprecated | Superseded by ADR-XXXX
- **Fecha**: YYYY-MM-DD
- **Decidido por**: <quién decidió>

## Contexto

Qué problema o restricción motivó la decisión. Incluye datos concretos
(costos, límites, errores, métricas) que la sustenten.

## Decisión

Lo que se decidió hacer. Una frase clara en presente.

## Alternativas consideradas

- **Opción A**: descripción + por qué se descartó.
- **Opción B**: descripción + por qué se descartó.

## Consecuencias

### Positivas
- …

### Negativas / costos
- …

### Riesgos a vigilar
- …

## Plan de revisión

Cuándo o bajo qué condiciones esta decisión debería revisarse.
```

## Índice

| # | Título | Estado |
|---|---|---|
| [0001](0001-caching-strategy-precios.md) | Estrategia de caché para scraping de precios | Accepted |
| [0002](0002-tcgmatch-api-publica.md) | Migrar a la API pública de TCGMatch (descontinuar Puppeteer) | Accepted |
