import upcoming from "../../data/upcoming.json";
import { json } from "../../lib/respond.js";

export const prerender = false;

export async function GET() {
  return json({ upcoming: upcoming.upcoming ?? [] });
}
