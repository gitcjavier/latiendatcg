// Helpers para responder en endpoints de Astro

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=60",
    },
  });
}

export function error(message, status = 500, detail) {
  return json({ error: message, ...(detail ? { detail } : {}) }, status);
}
