/**
 * Live data feeds, entity auto-linker, and threaded Telegram Bot/Channel connector
 * for GlancePulse G2 v2.0.
 *
 * Zero hardcoded secrets: Bot token, chat ID, and optional CORS proxy URL are
 * configured at runtime and persisted strictly in EvenHub / browser localStorage.
 */

export const FALLBACK_POLYMARKET = [
  {
    id: "pm-fed-dec",
    question: "No change in Fed rates after next FOMC meeting?",
    yesPct: 68,
    volume24h: 4250000,
    deltaPct: 2.8,
    slug: "fed-fomc-rates",
    tier: 2,
  },
  {
    id: "pm-btc-100k",
    question: "Will Bitcoin reach $100k before year end?",
    yesPct: 54,
    volume24h: 8420000,
    deltaPct: 4.1,
    slug: "btc-100k",
    tier: 2,
  },
  {
    id: "pm-eth-etf",
    question: "ETH ETF staking approved by Q2?",
    yesPct: 48,
    volume24h: 3910000,
    deltaPct: -1.6,
    slug: "eth-etf-staking",
    tier: 2,
  },
  {
    id: "pm-sol-etf",
    question: "Spot Solana ETF approved this year?",
    yesPct: 61,
    volume24h: 5180000,
    deltaPct: 3.3,
    slug: "sol-etf",
    tier: 2,
  },
  {
    id: "pm-nvda-ceo",
    question: "NVIDIA holds top AI chip share through 2026?",
    yesPct: 77,
    volume24h: 1920000,
    deltaPct: 1.9,
    slug: "nvda-ai-share",
    tier: 1,
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

export const FALLBACK_CANDLES = {
  BTC: [94100, 94350, 94210, 94680, 94920, 94750, 95100, 95480, 95220, 95740, 96010, 95880, 96250, 96420],
  ETH: [3360, 3372, 3355, 3380, 3394, 3388, 3402, 3415, 3404, 3418, 3422, 3416, 3425, 3428],
  SOL: [219.5, 220.8, 222.1, 221.4, 223.9, 225.2, 224.8, 227.1, 228.5, 227.9, 229.6, 230.2, 230.8, 231.4],
  HYPE: [26.8, 27.0, 26.9, 27.3, 27.5, 27.4, 27.8, 28.0, 27.9, 28.2, 28.4, 28.3, 28.5, 28.64],
  SUI: [3.92, 3.91, 3.93, 3.9, 3.89, 3.88, 3.9, 3.87, 3.86, 3.88, 3.86, 3.85, 3.85, 3.84],
  ARB: [1.19, 1.195, 1.192, 1.188, 1.19, 1.186, 1.185, 1.188, 1.184, 1.182, 1.185, 1.183, 1.181, 1.18],
};

export const DEMO_TELEGRAM_INBOX = [
  {
    id: 101,
    updateId: 1001,
    kind: "CHAT",
    from: "Alex (Desk)",
    chatId: "demo-desk-1",
    chatTitle: "Trading Desk",
    time: "10:42",
    text: "SOL funding >22% APR on HL. Trim 50% or hold?",
  },
  {
    id: 102,
    updateId: 1002,
    kind: "CHANNEL",
    from: "MacroAlpha",
    chatId: "demo-ch-macro",
    chatTitle: "MacroAlpha Ch",
    time: "10:39",
    text: "Fed FOMC rate odds moved on Polymarket. Sync?",
  },
  {
    id: 103,
    updateId: 1003,
    kind: "CHAT",
    from: "WhaleWatch",
    chatId: "demo-desk-2",
    chatTitle: "Whale Alerts",
    time: "10:31",
    text: "BTC perp OI +$64M in 15m on Hyperliquid.",
  },
  {
    id: 104,
    updateId: 1004,
    kind: "CHANNEL",
    from: "ETH Desk",
    chatId: "demo-ch-eth",
    chatTitle: "ETH Signals",
    time: "10:18",
    text: "ETH holding support; HYPE funding spiking.",
  },
];

export const VOICE_PRESET_TRANSCRIPTS = [
  "Trim half SOL now, arm 2% alert",
  "Holding BTC here, watching FOMC odds",
  "Back at desk in 5m, keep hedge on",
];

const SPORTS_FILTER_RE =
  /\b(vs\.?|spread:|o\/u|over\/under|nba|nfl|nhl|mlb|ufc|wwe|pga|atp|wta|uefa|fifa|premier league|champions league|la liga|serie a|bundesliga|playoffs|world series|super bowl|stanley cup|grand prix|f1|boxing|tennis|soccer|football|basketball|baseball|hockey|cricket|touchdown|rebounds|assists|goals|celtics|warriors|vikings|49ers|lakers|chiefs|eagles|arsenal|chelsea|liverpool|barcelona|real madrid|yankees|dodgers|bruins|rangers|shakhtar|knicks|heat|bucks|cowboys|packers|ravens)\b/i;

const CRYPTO_FED_RE =
  /\b(btc|bitcoin|eth|ethereum|sol|solana|hype|hyperliquid|crypto|defi|fed|fomc|interest rate|rate cut|rates|etf|sec|stablecoin|usdc|usdt|binance|coinbase|polymarket)\b/i;

const MACRO_TECH_RE =
  /\b(inflation|cpi|recession|tariff|gdp|nvidia|nvda|openai|ai|apple|tesla|microsoft|google|ceasefire|iran|oil|gold|treasury|s&p|nasdaq|election|trump|china)\b/i;

export function formatCompactUsd(n) {
  const num = Number(n) || 0;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

export function formatPrice(n) {
  const num = Number(n) || 0;
  if (num >= 10000) return num.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (num >= 1000) return num.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (num >= 10) return num.toFixed(2);
  return num.toFixed(3);
}

export function formatSignedPct(n, digits = 1) {
  const num = Number(n) || 0;
  return `${num >= 0 ? "+" : ""}${num.toFixed(digits)}%`;
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
 * Encode a Telegram BotFather token for URL paths while preserving the literal `:`
 * separator required by `https://api.telegram.org/bot<id>:<secret>/<method>`
 * and strict CORS proxy allowlists.
 */
export function encodeTelegramBotToken(botToken = "") {
  return encodeURIComponent(String(botToken ?? "").trim()).replace(/%3A/gi, ":");
}

/**
 * Resolve Telegram Bot API base URL (default `https://api.telegram.org`,
 * or user-configured self-hosted CORS relay worker URL without trailing slash).
 */
export function resolveTelegramBaseUrl(proxyUrl = "") {
  const clean = String(proxyUrl ?? "").trim().replace(/\/+$/, "");
  if (!clean) return "https://api.telegram.org";
  if (/^https?:\/\//i.test(clean)) return clean;
  return `https://${clean}`;
}

/**
 * Parse Polymarket Gamma API response (supports both `/markets/keyset` `{ markets }`
 * and legacy `/markets` array) while filtering out sports, expired, and settled odds.
 */
export function parsePolymarketResponse(rawPayload, { nowMs = Date.now(), minProb = 0.05, maxProb = 0.95 } = {}) {
  const rawList = Array.isArray(rawPayload)
    ? rawPayload
    : Array.isArray(rawPayload?.markets)
      ? rawPayload.markets
      : [];
  if (rawList.length === 0) return [];

  const parsed = [];
  for (const m of rawList) {
    if (!m || !m.question) continue;
    const question = truncateAscii(m.question, 68);
    if (SPORTS_FILTER_RE.test(question)) continue;

    if (m.endDate) {
      const endMs = Date.parse(m.endDate);
      if (Number.isFinite(endMs) && endMs <= nowMs) continue;
    }

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
    if (!Number.isFinite(yesRaw) || yesRaw < minProb || yesRaw > maxProb) continue;

    const vol = Number(m.volume24hr ?? m.volumeNum ?? m.volume ?? 0);
    const delta = Number(m.oneDayPriceChange ?? 0) * 100;
    const tier = CRYPTO_FED_RE.test(question) ? 2 : MACRO_TECH_RE.test(question) ? 1 : 0;

    parsed.push({
      id: String(m.id ?? m.conditionId ?? parsed.length),
      question,
      yesPct: Math.round(yesRaw * 100),
      volume24h: Number.isFinite(vol) ? vol : 0,
      deltaPct: Number.isFinite(delta) ? Number(delta.toFixed(1)) : 0,
      slug: String(m.slug ?? ""),
      endDate: m.endDate ? String(m.endDate) : "",
      tier,
    });
  }

  parsed.sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier;
    return b.volume24h - a.volume24h;
  });

  return parsed.slice(0, 8);
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
 * Fetch live Polymarket crypto/macro markets via `/markets/keyset` (with legacy fallback).
 */
export async function fetchPolymarketMarkets(fetchImpl = globalThis.fetch, nowMs = Date.now()) {
  const minIso = new Date(nowMs + 6 * 3600 * 1000).toISOString();
  const urls = [
    `https://gamma-api.polymarket.com/markets/keyset?active=true&closed=false&limit=60&order=volume24hr&ascending=false&end_date_min=${encodeURIComponent(minIso)}`,
    `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=60&order=volume24hr&ascending=false`,
  ];

  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(9500) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const parsed = parsePolymarketResponse(data, { nowMs });
      if (parsed.length > 0) {
        return { source: "LIVE", markets: parsed, fetchedAt: nowMs };
      }
      throw new Error("No active crypto/macro markets after filter");
    } catch (err) {
      lastErr = err;
    }
  }
  return { source: "DEMO", markets: FALLBACK_POLYMARKET, fetchedAt: nowMs, error: lastErr?.message };
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
 * Fetch live 24h hourly close prices for a Hyperliquid coin via `candleSnapshot`.
 */
export async function fetchHyperliquidCandles(coin, fetchImpl = globalThis.fetch, nowMs = Date.now()) {
  const sym = String(coin || "BTC").toUpperCase();
  try {
    const res = await fetchImpl("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: {
          coin: sym,
          interval: "1h",
          startTime: nowMs - 24 * 3600 * 1000,
          endTime: nowMs,
        },
      }),
      signal: AbortSignal.timeout(5500),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length < 2) throw new Error("Insufficient candles");
    const closes = arr.map((c) => Number(c?.c ?? c?.o)).filter(Number.isFinite);
    if (closes.length >= 2) {
      return { source: "LIVE", coin: sym, closes };
    }
    throw new Error("Invalid candle numbers");
  } catch {
    return {
      source: "DEMO",
      coin: sym,
      closes: FALLBACK_CANDLES[sym] || FALLBACK_CANDLES.BTC,
    };
  }
}

const COIN_ALIASES = [
  { coin: "BTC", re: /\b(btc|bitcoin)\b/i },
  { coin: "ETH", re: /\b(eth|ethereum)\b/i },
  { coin: "SOL", re: /\b(sol|solana)\b/i },
  { coin: "HYPE", re: /\b(hype|hyperliquid)\b/i },
  { coin: "SUI", re: /\b(sui)\b/i },
  { coin: "ARB", re: /\b(arb|arbitrum)\b/i },
];

const PM_TOPIC_RE = /\b(polymarket|odds|fomc|fed|rate|rates|etf|election|ceasefire|nvidia|nvda|iran|tariff|inflation|cpi)\b/i;

/**
 * Auto-link an incoming Telegram message or channel post to live Hyperliquid
 * perp data (+ 24h sparkline) or Polymarket prediction odds.
 */
export function extractMarketContext(message, { perps = [], markets = [], candlesByCoin = {} } = {}) {
  const text = String(message?.text || "");
  const isPmExplicit = PM_TOPIC_RE.test(text);

  // Check Polymarket match first if explicitly asking about odds/macro/Fed
  if (isPmExplicit && markets.length > 0) {
    const words = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !["the", "and", "for", "with", "from", "this", "that", "odds", "polymarket"].includes(w));
    let best = markets[0];
    let bestScore = -1;
    for (const m of markets) {
      const qLower = m.question.toLowerCase();
      let score = 0;
      for (const w of words) {
        if (qLower.includes(w)) score += 2;
      }
      if (/\b(fomc|fed|rate)\b/i.test(text) && /\b(fed|fomc|rate)\b/i.test(qLower)) score += 5;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return {
      matched: true,
      kind: "polymarket",
      market: best,
      perp: perps[0] || null,
      candles: candlesByCoin[perps[0]?.coin || "BTC"] || FALLBACK_CANDLES.BTC,
      kpiShort: `PM YES ${best.yesPct}%`,
      tag: "PM ODDS",
    };
  }

  // Check coin mentions (explicit coin wins over generic "Hyperliquid" mention)
  let detectedCoin = null;
  for (const entry of COIN_ALIASES) {
    if (entry.coin === "HYPE" && /\bhyperliquid\b/i.test(text) && !/\bhype\b/i.test(text)) {
      continue;
    }
    if (entry.re.test(text)) {
      detectedCoin = entry.coin;
      break;
    }
  }

  const matchedPerp =
    (detectedCoin && perps.find((p) => p.coin === detectedCoin)) ||
    perps[0] ||
    FALLBACK_HYPERLIQUID[0];

  const candles =
    candlesByCoin[matchedPerp.coin] ||
    FALLBACK_CANDLES[matchedPerp.coin] ||
    FALLBACK_CANDLES.BTC;

  return {
    matched: Boolean(detectedCoin),
    kind: "perp",
    perp: matchedPerp,
    market: markets[0] || null,
    candles,
    kpiShort: `${matchedPerp.coin} $${formatPrice(matchedPerp.markPx)}`,
    tag: `${matchedPerp.coin} 24H`,
  };
}

/**
 * Generate 3 concise, context-aware Telegram replies pre-populated with live market data.
 */
export function buildSmartReplies(message, context, state) {
  if (context?.kind === "polymarket" && context.market) {
    const m = context.market;
    return [
      {
        id: "ctx-pm-ack",
        label: truncateAscii(`Ack PM (${m.yesPct}% YES)`, 30),
        text: `[G2] Tracking "${truncateAscii(m.question, 48)}" at ${m.yesPct}% YES (${formatSignedPct(m.deltaPct)} 24h).`,
      },
      {
        id: "ctx-pm-arm",
        label: truncateAscii(`Arm PM ±5% & Reply`, 30),
        text: `[G2] Armed ±5% G2 alert on "${truncateAscii(m.question, 42)}" (anchor ${m.yesPct}% YES).`,
        armAlert: { kind: "polymarket", target: m.id, anchorPct: m.yesPct, thresholdPct: 5 },
      },
      {
        id: "ctx-pulse",
        label: "Send Live Market Pulse",
        text: buildPulseSummaryText(state),
      },
    ];
  }

  const p = context?.perp || state?.perps?.[0] || FALLBACK_HYPERLIQUID[0];
  const fundingHigh = Math.abs(p.fundingApr) >= 18;
  return [
    {
      id: "ctx-perp-act",
      label: truncateAscii(
        fundingHigh ? `Trim 50% ${p.coin} ($${formatPrice(p.markPx)})` : `Ack ${p.coin} ($${formatPrice(p.markPx)})`,
        30
      ),
      text: fundingHigh
        ? `[G2] Trimming 50% ${p.coin} perp at $${formatPrice(p.markPx)} (${formatSignedPct(p.change24h)}, APR ${p.fundingApr}%).`
        : `[G2] Copy on ${p.coin} — live mark $${formatPrice(p.markPx)} (${formatSignedPct(p.change24h)}, APR ${p.fundingApr}%).`,
    },
    {
      id: "ctx-perp-arm",
      label: truncateAscii(`Hold + Arm ${p.coin} ±2%`, 30),
      text: `[G2] Holding ${p.coin} at $${formatPrice(p.markPx)} — armed ±2% G2 alert.`,
      armAlert: { kind: "perp", target: p.coin, anchorPrice: p.markPx, thresholdPct: 2.0, fundingLimit: 35 },
    },
    {
      id: "ctx-pulse",
      label: "Send Live Market Pulse",
      text: buildPulseSummaryText(state),
    },
  ];
}

/**
 * Deduplicate and merge incoming Telegram messages/channel posts (newest first).
 */
export function mergeInboxMessages(existing = [], incoming = [], maxItems = 12) {
  const byKey = new Map();
  for (const m of [...incoming, ...existing]) {
    if (!m || !m.text) continue;
    const key = `${m.chatId || "default"}:${m.id}`;
    if (!byKey.has(key)) {
      byKey.set(key, m);
    }
  }
  return Array.from(byKey.values()).slice(0, maxItems);
}

/**
 * Read latest Telegram direct/group messages AND channel posts via Bot API `getUpdates`
 * with proper `offset` (`update_id + 1`) pagination.
 */
export async function fetchTelegramInbox(
  { botToken, chatId = "", offset = 0, proxyUrl = "" },
  fetchImpl = globalThis.fetch
) {
  if (!botToken) {
    return { source: "DEMO", messages: DEMO_TELEGRAM_INBOX, nextOffset: offset };
  }
  try {
    const base = resolveTelegramBaseUrl(proxyUrl);
    const params = new URLSearchParams({
      limit: "20",
      allowed_updates: JSON.stringify(["message", "channel_post"]),
    });
    if (Number(offset) > 0) {
      params.set("offset", String(Number(offset)));
    }
    const url = `${base}/bot${encodeTelegramBotToken(botToken)}/getUpdates?${params.toString()}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(6500) });
    if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || "Telegram API error");

    let maxUpdateId = Number(offset) > 0 ? Number(offset) - 1 : 0;
    let discoveredChatId = "";
    const parsed = [];

    for (const u of json.result || []) {
      if (typeof u.update_id === "number" && u.update_id > maxUpdateId) {
        maxUpdateId = u.update_id;
      }
      const isChannel = Boolean(u.channel_post && !u.message);
      const m = u.message || u.channel_post;
      const bodyText = m?.text || m?.caption;
      if (!m || !bodyText) continue;

      const msgChatId = String(m.chat?.id ?? "");
      if (!discoveredChatId && msgChatId) discoveredChatId = msgChatId;
      if (chatId && msgChatId && msgChatId !== String(chatId)) continue;

      const dt = new Date((m.date || Math.floor(Date.now() / 1000)) * 1000);
      const hh = String(dt.getHours()).padStart(2, "0");
      const mm = String(dt.getMinutes()).padStart(2, "0");
      const sender = isChannel
        ? m.chat?.title || m.author_signature || "Channel"
        : m.from?.first_name || m.from?.username || m.chat?.title || "Telegram";

      parsed.push({
        id: m.message_id,
        updateId: u.update_id,
        kind: isChannel ? "CHANNEL" : "CHAT",
        from: truncateAscii(sender, 16),
        chatId: msgChatId,
        chatTitle: truncateAscii(m.chat?.title || sender, 18),
        time: `${hh}:${mm}`,
        text: truncateAscii(bodyText, 120),
      });
    }

    parsed.reverse(); // newest first
    const nextOffset = maxUpdateId > 0 ? maxUpdateId + 1 : Number(offset) || 0;
    return {
      source: "LIVE",
      messages: parsed,
      nextOffset,
      discoveredChatId,
    };
  } catch (err) {
    return {
      source: "DEMO",
      messages: [],
      nextOffset: offset,
      error: err?.message || "Telegram fetch failed",
    };
  }
}

/**
 * Send a threaded reply or pulse broadcast to Telegram via Bot API `sendMessage`.
 * Supports `reply_to_message_id` and optional self-hosted CORS proxy URL.
 */
export async function sendTelegramMessage(
  { botToken, chatId, text, replyToMessageId = null, proxyUrl = "" },
  fetchImpl = globalThis.fetch
) {
  const cleanText = String(text ?? "").trim();
  if (!cleanText) throw new Error("Message text cannot be empty");

  if (!botToken || !chatId || String(chatId).startsWith("demo-")) {
    return {
      ok: true,
      mode: "DEMO",
      sentAt: Date.now(),
      replyToMessageId: replyToMessageId || undefined,
      preview: truncateAscii(cleanText, 96),
    };
  }

  const base = resolveTelegramBaseUrl(proxyUrl);
  const url = `${base}/bot${encodeTelegramBotToken(botToken)}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: cleanText,
    disable_web_page_preview: true,
  };
  if (typeof replyToMessageId === "number" && replyToMessageId > 0) {
    payload.reply_to_message_id = replyToMessageId;
  }

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
      replyToMessageId: payload.reply_to_message_id,
      sentAt: Date.now(),
      preview: truncateAscii(cleanText, 96),
    };
  } catch (err) {
    const msg = String(err?.message || err);
    if (/failed to fetch|cors|networkerror/i.test(msg) && !proxyUrl) {
      throw new Error("Browser CORS blocked api.telegram.org — set CORS Proxy URL or run in Even App");
    }
    throw err;
  }
}

/**
 * Build a concise Telegram pulse report summarizing current live feeds.
 */
export function buildPulseSummaryText(state) {
  const topPerps = (state?.perps || [])
    .slice(0, 3)
    .map((p) => `${p.coin} $${formatPrice(p.markPx)} (${formatSignedPct(p.change24h)}, APR ${p.fundingApr}%)`)
    .join(" | ");
  const topMarket = state?.markets?.[0];
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
  for (const alert of state?.alerts || []) {
    if (alert.triggered) continue;
    if (alert.kind === "perp") {
      const row = (state.perps || []).find((p) => p.coin === alert.target);
      if (!row || !alert.anchorPrice) continue;
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
          reason: `PM "${truncateAscii(m.question, 26)}" -> ${m.yesPct}% YES`,
        });
      }
    }
  }
  return triggered;
}
