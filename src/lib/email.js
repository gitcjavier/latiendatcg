// Wrapper mínimo de Resend (https://resend.com). Sin dependencias — fetch nativo.
// Env var: RESEND_API_KEY (setear en Netlify Site settings → Environment).
//
// Remitente por defecto: onboarding@resend.dev — sandbox de Resend, funciona sin
// verificar dominio. Cuando el usuario quiera usar su propio dominio,
// agrega y verifica DNS en resend.com y cambia el `from`.

export async function sendMail({ to, subject, html, from = "LaTiendaTCG <onboarding@resend.dev>" }) {
  const key = process.env.RESEND_API_KEY ?? import.meta.env?.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY no configurado");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}
