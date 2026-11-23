/**
 * Optional Zero-Secret CORS Relay for Standalone Browser Testing of GlancePulse G2.
 *
 * Inside the native Even App Flutter WebView, `app.json` whitelists
 * `https://api.telegram.org` directly. When testing GlancePulse in a desktop
 * browser (e.g. GitHub Pages), Telegram Bot API omits CORS headers on JSON POSTs.
 *
 * Deploy this Worker on your own Cloudflare account (`wrangler deploy`),
 * then paste its URL into GlancePulse's optional "CORS Proxy URL" field.
 * Zero secrets are stored on the Worker — only allowlisted Bot API paths pass.
 */

const ALLOWED_METHODS = new Set(["getMe", "getUpdates", "sendMessage"]);
const BOT_PATH_RE = /^\/bot([0-9]+:[A-Za-z0-9_-]+)\/([A-Za-z]+)$/;

export function parseTelegramProxyPath(pathname) {
  const normalized = String(pathname ?? "").replace(/%3A/gi, ":");
  const match = normalized.match(BOT_PATH_RE);
  if (!match || !ALLOWED_METHODS.has(match[2])) {
    return null;
  }
  return {
    normalizedPath: normalized,
    token: match[1],
    method: match[2],
  };
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "*";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    const parsed = parseTelegramProxyPath(url.pathname);
    if (!parsed) {
      return new Response(JSON.stringify({ ok: false, description: "Disallowed Telegram Bot API method" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    const upstream = `https://api.telegram.org${parsed.normalizedPath}${url.search}`;
    const res = await fetch(upstream, {
      method: request.method,
      headers: request.method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: request.method === "POST" ? await request.text() : undefined,
    });

    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  },
};
