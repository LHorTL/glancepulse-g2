/**
 * Live data feeds + Read/Write Telegram Bot connector for GlancePulse G2.
 * Zero hardcoded secrets: Telegram bot token and chat ID are configured at
 * runtime by the user and persisted only in EvenHub/browser local storage.
 */

export const FALLBACK_POLYMARKET = [
  {
    id: "pm-btc-120k",
    question: "Will Bitcoin reach $120k before Q2?",
    yesPct: 62,
    volume24h: 8420000,
    deltaPct: 4.1,
    slug: "btc-120k",
  },
  {
    id: "pm-fed-cut",
    question: "Fed cuts rates at next FOMC meeting?",
    yesPct: 71,
    volume24h: 11250000,
    deltaPct: 2.8,
    slug: "fed-rate-cut",
  },
  {
    id: "pm-eth-etf-stake",
    question: "ETH ETF staking approved by June?",
    yesPct: 48,
    volume24h: 3910000,
    deltaPct: -1.6,
    slug: "eth-etf-staking",
  },
  {
    id: "pm-sol-ath",
    question: "Solana hits new ATH this quarter?",
    yesPct: 54,
    volume24h: 5180000,
    deltaPct: 3.3,
    slug: "sol-ath",
  },
  {
    id: "pm-ai-agents",
    question: "Open-weights model tops coding bench?",
    yesPct: 39,
    volume24h: 1920000,
    deltaPct: 1.9,
    slug: "open-weights-bench",
  },
];

export const FALLBACK_HYPERLIQUID = [
  { coin: "BTC", markPx: 96420.5, change24h: 2.34, fundingApr: 14.2, openInterestUsd: 1890000000 },
  { coin: "ETH", markPx: 3428.8, change24h: 1.72, fundingApr: 11.8, openInterestUsd: 920000000 },
  { coin: "SOL", markPx: 231.45, change24h: 4.85, fundingApr: 22.6, openInterestUsd: 470000000 },
  { coin: "HYPE", markPx: 28.64, change24h: 6.12, fundingApr: 31.4, openInterestUsd: 265000000 },
  { coin: "SUI", markPx: 3.84, change24h: -1.42, fundingApr: 8.5, openInterestUsd: 142000000 },
  { coin: "ARB", markPx: 1.18, change24h: -0.64, fundingApr: 6.1, openInterestUsd: 98000000 },
];

export const DEMO_TELEGRAM_INBOX = [
  {
    id: 101,
    from: "DeskAlphaBot",
    time: "10:42",
    text: "SOL funding > 22% APR on Hyperliquid. Trim or hedge?",
  },
  {
    id: 102,
    from: "Alex (PM Desk)",
    time: "10:39",
    text: "FOMC cut odds spiked +3% on Polymarket. Ready to sync?",
  },
  {
    id: 103,
    from: "WhaleWatch",
    time: "10:31",
    text: "BTC perp OI +$64M in 15m across Hyperliquid.",
  },
  {
    id: 104,
    from: "OpsAlert",
    time: "10:18",
    text: "All RPC relays healthy. Latency 42ms.",
  },
];

export const QUICK_REPLIES = [
  { id: "ack", label: "ACK - On it", text: "[G2 HUD] ACK — saw it, on it now." },
  { id: "hedge", label: "HEDGE 50%", text: "[G2 HUD] Action signal: Hedge 50% delta." },
  { id: "5min", label: "Call in 5m", text: "[G2 HUD] Stepping away — will call in 5 min." },
  { id: "pulse", label: "Send Pulse", text: "__DYNAMIC_PULSE__" },
];

export function formatCompactUsd(n) {
  const num = Number(n) || 0;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

export function formatPrice(n) {
  const num = Number(n) || 0;
  if (num >= 1000) return num.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (num >= 10) return num.toFixed(2);
  return num.toFixed(3);
}

export function formatSignedPct(n) {
  const num = Number(n) || 0;
  return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
}

export function truncateAscii(str, maxLen) {
  const clean = String(str ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= maxLen) return clean;
  return maxLen > 3 ? `${clean.slice(0, maxLen - 3)}...` : clean.slice(0, maxLen);
}

/**
 * Parse raw Polymarket Gamma API markets array into compact G2 rows.
 */
export function parsePolymarketResponse(rawList) {
  if (!Array.isArray(rawList)) return [];
  const parsed = [];
  for (const m of rawList) {
    if (!m || !m.question) continue;
    let prices = [];
    if (Array.isArray(m.outcomePrices)) {
      prices = m.outcomePrices;
    } else if (typeof m.outcomePrices === "string") {
      try {
        prices = JSON.parse(m.outcomePrices);
      } catch {
        prices = [];
      }
    }
    const yesRaw = Number(prices[0]);
    if (!Number.isFinite(yesRaw) || yesRaw <= 0 || yesRaw >= 1) continue;
    const vol = Number(m.volume24hr ?? m.volumeNum ?? m.volume ?? 0);
    const delta = Number(m.oneDayPriceChange ?? 0) * 100;
    parsed.push({
      id: String(m.id ?? m.conditionId ?? parsed.length),
      question: truncateAscii(m.question, 64),
      yesPct: Math.round(yesRaw * 100),
      volume24h: Number.isFinite(vol) ? vol : 0,
      deltaPct: Number.isFinite(delta) ? Number(delta.toFixed(1)) : 0,
      slug: String(m.slug ?? ""),
    });
    if (parsed.length >= 8) break;
  }
  return parsed;
}

/**
 * Parse Hyperliquid `metaAndAssetCtxs` tuple `[meta, ctxs]` for priority coins.
 */
export function parseHyperliquidResponse(rawTuple, priorityCoins = ["BTC", "ETH", "SOL", "HYPE", "SUI", "ARB"]) {
  if (!Array.isArray(rawTuple) || rawTuple.length < 2) return [];
  const universe = rawTuple[0]?.universe;
  const ctxs = rawTuple[1];
  if (!Array.isArray(universe) || !Array.isArray(ctxs)) return [];

  const byCoin = new Map();
  for (let i = 0; i < Math.min(universe.length, ctxs.length); i++) {
    const coin = universe[i]?.name;
    const ctx = ctxs[i];
    if (!coin || !ctx) continue;
    const markPx = Number(ctx.markPx ?? ctx.midPx ?? 0);
    const prevDayPx = Number(ctx.prevDayPx ?? 0);
    if (!Number.isFinite(markPx) || markPx <= 0) continue;
    const change24h = prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0;
    const hourlyFunding = Number(ctx.funding ?? 0);
    const fundingApr = Number.isFinite(hourlyFunding) ? hourlyFunding * 24 * 365 * 100 : 0;
    const oiCoins = Number(ctx.openInterest ?? 0);
    const openInterestUsd = Number.isFinite(oiCoins) ? oiCoins * markPx : 0;
    byCoin.set(coin, {
      coin,
      markPx,
      change24h: Number(change24h.toFixed(2)),
      fundingApr: Number(fundingApr.toFixed(1)),
      openInterestUsd,
    });
  }

  const out = [];
  for (const c of priorityCoins) {
    if (byCoin.has(c)) out.push(byCoin.get(c));
  }
  for (const [coin, row] of byCoin.entries()) {
    if (out.length >= 8) break;
    if (!priorityCoins.includes(coin)) out.push(row);
  }
  return out;
}

/**
 * Fetch live Polymarket markets with graceful fallback.
 */
export async function fetchPolymarketMarkets(fetchImpl = globalThis.fetch) {
  try {
    const url =
      "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=15&order=volume24hr&ascending=false";
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const parsed = parsePolymarketResponse(data);
    if (parsed.length > 0) {
      return { source: "LIVE", markets: parsed, fetchedAt: Date.now() };
    }
    throw new Error("Empty parsed markets");
  } catch (err) {
    return { source: "DEMO", markets: FALLBACK_POLYMARKET, fetchedAt: Date.now(), error: err?.message };
  }
}

/**
 * Fetch live Hyperliquid perpetuals with graceful fallback.
 */
export async function fetchHyperliquidPerps(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      signal: AbortSignal.timeout(5500),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const parsed = parseHyperliquidResponse(data);
    if (parsed.length > 0) {
      return { source: "LIVE", perps: parsed, fetchedAt: Date.now() };
    }
    throw new Error("Empty Hyperliquid response");
  } catch (err) {
    return { source: "DEMO", perps: FALLBACK_HYPERLIQUID, fetchedAt: Date.now(), error: err?.message };
  }
}

/**
 * Read latest Telegram messages via Bot API getUpdates (or demo inbox if unconfigured).
 */
export async function fetchTelegramInbox({ botToken, chatId }, fetchImpl = globalThis.fetch) {
  if (!botToken) {
    return { source: "DEMO", messages: DEMO_TELEGRAM_INBOX };
  }
  try {
    const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/getUpdates?limit=15&allowed_updates=%5B%22message%22%5D`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5500) });
    if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || "Telegram API error");
    const messages = (json.result || [])
      .map((u) => u.message)
      .filter((m) => m && m.text && (!chatId || String(m.chat?.id) === String(chatId)))
      .slice(-8)
      .reverse()
      .map((m) => {
        const dt = new Date((m.date || Math.floor(Date.now() / 1000)) * 1000);
        const hh = String(dt.getHours()).padStart(2, "0");
        const mm = String(dt.getMinutes()).padStart(2, "0");
        return {
          id: m.message_id,
          from: truncateAscii(m.from?.first_name || m.from?.username || "Telegram", 18),
          time: `${hh}:${mm}`,
          text: truncateAscii(m.text, 90),
          chatId: String(m.chat?.id || ""),
        };
      });
    return {
      source: "LIVE",
      messages: messages.length > 0 ? messages : [{ id: 0, from: "Bot", time: "--:--", text: "Connected. Send a message to your bot to see it on G2." }],
    };
  } catch (err) {
    return { source: "DEMO", messages: DEMO_TELEGRAM_INBOX, error: err?.message };
  }
}

/**
 * Write a real message or quick-reply to Telegram via Bot API sendMessage.
 * In demo mode (no token), records an instant local outbox receipt cleanly.
 */
export async function sendTelegramMessage({ botToken, chatId, text }, fetchImpl = globalThis.fetch) {
  const cleanText = String(text ?? "").trim();
  if (!cleanText) throw new Error("Message text cannot be empty");

  if (!botToken || !chatId) {
    return {
      ok: true,
      mode: "DEMO",
      sentAt: Date.now(),
      preview: truncateAscii(cleanText, 96),
    };
  }

  const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: cleanText,
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(5500),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(json.description || `Telegram sendMessage HTTP ${res.status}`);
  }
  return {
    ok: true,
    mode: "LIVE",
    messageId: json.result?.message_id,
    sentAt: Date.now(),
    preview: truncateAscii(cleanText, 96),
  };
}

/**
 * Build a concise Telegram pulse report summarizing current live feeds.
 */
export function buildPulseSummaryText(state) {
  const topPerps = (state.perps || [])
    .slice(0, 3)
    .map((p) => `${p.coin} $${formatPrice(p.markPx)} (${formatSignedPct(p.change24h)}, APR ${p.fundingApr}%)`)
    .join(" | ");
  const topMarket = state.markets?.[0];
  const pmLine = topMarket
    ? `Polymarket: ${topMarket.question} -> YES ${topMarket.yesPct}% (${formatCompactUsd(topMarket.volume24h)})`
    : "Polymarket: unavailable";
  return `[GlancePulse G2]\nPerps: ${topPerps}\n${pmLine}`;
}

/**
 * Evaluate armed alerts against latest perp & polymarket data.
 */
export function evaluateAlerts(state) {
  const triggered = [];
  for (const alert of state.alerts || []) {
    if (alert.triggered) continue;
    if (alert.kind === "perp") {
      const row = (state.perps || []).find((p) => p.coin === alert.target);
      if (!row) continue;
      const pctMove = ((row.markPx - alert.anchorPrice) / alert.anchorPrice) * 100;
      if (Math.abs(pctMove) >= alert.thresholdPct || Math.abs(row.fundingApr) >= alert.fundingLimit) {
        triggered.push({
          ...alert,
          reason:
            Math.abs(pctMove) >= alert.thresholdPct
              ? `${row.coin} moved ${formatSignedPct(pctMove)} ($${formatPrice(row.markPx)})`
              : `${row.coin} funding ${row.fundingApr}% APR`,
        });
      }
    } else if (alert.kind === "polymarket") {
      const m = (state.markets || []).find((x) => x.id === alert.target);
      if (!m) continue;
      if (Math.abs(m.yesPct - alert.anchorPct) >= alert.thresholdPct) {
        triggered.push({
          ...alert,
          reason: `PM "${truncateAscii(m.question, 26)}" moved to ${m.yesPct}%`,
        });
      }
    }
  }
  return triggered;
}
