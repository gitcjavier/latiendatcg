// Endpoint disparado por el cron de GitHub Actions (una vez al día).
// Hace scrape del 30° aniversario, arma un HTML con los top 5 más baratos por
// categoría y envía email a icastroretamal@gmail.com vía Resend.
//
// Método: POST
// Auth:   header `Authorization: Bearer ${CRON_SECRET}`
// Env:    RESEND_API_KEY, CRON_SECRET (ambos en Netlify env vars)

import { searchAniversario30 } from "../../../lib/preventas.js";
import { sendMail } from "../../../lib/email.js";
import { json, error } from "../../../lib/respond.js";

export const prerender = false;

const TO = "icastroretamal@gmail.com";
const TOP_N_PER_CATEGORY = 5;

export async function POST({ request }) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET ?? import.meta.env?.CRON_SECRET;
  if (!expected) return error("CRON_SECRET no configurado en el server", 500);
  if (auth !== `Bearer ${expected}`) return error("No autorizado", 401);

  let data;
  try {
    data = await searchAniversario30({ onlyInStock: true });
  } catch (e) {
    console.error("[/api/aniversario/report] scrape falló", e.message);
    return error("Scrape falló", 500, e.message);
  }

  const totalProducts = data.total ?? 0;
  // El reporte ahora agrupa por tienda. Se conserva el nombre TOP_N_PER_CATEGORY
  // por compatibilidad; el semántico real es "top N por tienda".
  const shortlisted = (data.storeGroups ?? []).map(g => ({
    label: g.storeName,
    products: g.products.slice(0, TOP_N_PER_CATEGORY),
  }));

  const today = new Date().toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const html = renderEmail({ groups: shortlisted, totalProducts, today });

  try {
    await sendMail({
      to: TO,
      subject: `LaTiendaTCG — Aniversario 30° · ${today}`,
      html,
    });
  } catch (e) {
    console.error("[/api/aniversario/report] envío falló", e.message);
    return error("Envío de email falló", 500, e.message);
  }

  return json({
    sent: true,
    to: TO,
    totalProducts,
    categoriesReported: shortlisted.length,
    sentAt: new Date().toISOString(),
  });
}

function fmtCLP(n) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// HTML minimal — tabla por categoría, precios en CLP, links a la tienda.
// Diseño plano, sin ornamentos (consistente con la web).
function renderEmail({ groups, totalProducts, today }) {
  if (!groups.length) {
    return `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #0b0b0b;">
        <h1 style="font-size: 22px; margin: 0 0 8px;">Aniversario 30° · ${today}</h1>
        <p style="color: #6b6b6b;">Hoy no hay productos con stock en las tiendas escaneadas.</p>
      </div>
    `.trim();
  }

  const sections = groups
    .map(g => {
      const rows = g.products
        .map(p => `
          <tr>
            <td style="padding: 10px 8px; border-bottom: 1px solid #eee;">
              <a href="${escapeHtml(p.url)}" style="color: #0b0b0b; text-decoration: none; font-weight: 600;">
                ${escapeHtml(p.title)}
              </a>
              <div style="font-size: 11px; color: #9a9a9a; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.05em;">
                ${escapeHtml(p.store)}
              </div>
            </td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #eee; text-align: right; font-weight: 700; font-family: 'Menlo', monospace; white-space: nowrap;">
              ${fmtCLP(p.price)}
            </td>
          </tr>
        `)
        .join("");

      return `
        <section style="margin: 32px 0 0;">
          <h2 style="font-size: 15px; margin: 0 0 4px; letter-spacing: 0.06em; text-transform: uppercase; color: #1d4ed8;">
            ${escapeHtml(g.label)}
          </h2>
          <p style="font-size: 11px; color: #9a9a9a; margin: 0 0 12px; letter-spacing: 0.08em; text-transform: uppercase;">
            Top ${g.products.length} más baratos con stock
          </p>
          <table style="width: 100%; border-collapse: collapse;">
            ${rows}
          </table>
        </section>
      `;
    })
    .join("");

  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #0b0b0b;">
      <div style="border-bottom: 2px solid #1d4ed8; padding-bottom: 12px; margin-bottom: 16px;">
        <p style="font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #1d4ed8; margin: 0;">
          LaTiendaTCG · Reporte diario
        </p>
        <h1 style="font-size: 26px; margin: 4px 0 0; font-weight: 800;">
          Aniversario 30° · ${today}
        </h1>
        <p style="color: #6b6b6b; margin: 6px 0 0; font-size: 13px;">
          ${totalProducts} productos con stock hoy, agrupados por categoría (más baratos primero).
        </p>
      </div>
      ${sections}
      <p style="margin-top: 40px; font-size: 11px; color: #9a9a9a; text-align: center;">
        Enviado desde <a href="https://latiendatcg.netlify.app/aniversario" style="color: #1d4ed8; text-decoration: none;">latiendatcg.netlify.app</a>
      </p>
    </div>
  `.trim();
}
