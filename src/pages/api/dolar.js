import { getDolarRate } from "../../lib/dolar.js";
import { json, error } from "../../lib/respond.js";

export const prerender = false;

export async function GET() {
  try {
    const rate = await getDolarRate();
    if (!rate) return error("No se pudo obtener el tipo de cambio.", 503);
    return json({ rate, updatedAt: new Date().toISOString() });
  } catch (err) {
    return error(err.message, 500);
  }
}
