/**
 * Non-custodial Crypto & DeFi Voice Intent Parser and Paper Trading Engine
 * for GlancePulse G2 v2.1.
 *
 * ZERO private keys, ZERO wallet signing, ZERO custody:
 *   - Parses spoken or simulated G2 voice commands into structured Paper Perp
 *     Orders (`Long BTC 100`, `Short ETH 250 5x`) or Polymarket Paper Bets
 *     (`Bet Yes 50 on Fed`, `Bet No $25 on Bitcoin`).
 *   - Persists paper positions/bets in EvenHub/browser storage and marks them to
 *     real-time live Hyperliquid mid/mark prices and Polymarket YES/NO odds.
 */

import { formatCompactUsd, formatPrice, truncateAscii } from "./feeds.js";

export const DEFAULT_PAPER_STARTING_CASH = 10000;
export const DEFAULT_PAPER_LEVERAGE = 3;
export const MIN_ORDER_USD = 10;
export const MAX_ORDER_USD = 100000;

export const VOICE_TRADE_PRESETS = [
  { id: "long-btc", label: "Long BTC $100", transcript: "Long BTC 100" },
  { id: "short-eth", label: "Short ETH $250", transcript: "Short ETH 250" },
  { id: "bet-fed", label: "Bet Yes $50 Fed", transcript: "Bet Yes 50 on Fed" },
];

const COIN_SYNONYMS = {
  btc: "BTC",
  bitcoin: "BTC",
  eth: "ETH",
  ethereum: "ETH",
  ether: "ETH",
  sol: "SOL",
  solana: "SOL",
  hype: "HYPE",
  hyperliquid: "HYPE",
  sui: "SUI",
  arb: "ARB",
  arbitrum: "ARB",
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "will",
  "into",
  "over",
  "under",
  "about",
  "polymarket",
  "market",
  "odds",
  "yes",
  "no",
  "bet",
  "buy",
  "usd",
  "usdc",
  "dollars",
  "bucks",
]);

export function formatSignedUsd(n, { compact = false } = {}) {
  const num = Number(n) || 0;
  const sign = num >= 0 ? "+" : "-";
  const abs = Math.abs(num);
  if (compact && abs >= 1000) {
    return `${sign}${formatCompactUsd(abs)}`;
  }
  if (abs >= 1000) {
    return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatUsd(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  if (abs >= 1000) {
    return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${sign}$${abs.toFixed(2)}`;
}

function parseAmountToken(numStr, suffixK = "") {
  const base = Number(numStr);
  if (!Number.isFinite(base) || base <= 0) return null;
  const scaled = suffixK && suffixK.toLowerCase() === "k" ? base * 1000 : base;
  return Math.max(MIN_ORDER_USD, Math.min(MAX_ORDER_USD, Math.round(scaled * 100) / 100));
}

function resolveCoinSymbol(rawToken, perps = []) {
  const key = String(rawToken || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key) return null;
  if (COIN_SYNONYMS[key]) return COIN_SYNONYMS[key];
  const upper = key.toUpperCase();
  const match = (perps || []).find((p) => String(p.coin || "").toUpperCase() === upper);
  return match ? match.coin : null;
}

function findBestPolymarket(topicRaw, markets = [], activeMarket = null) {
  if (!Array.isArray(markets) || markets.length === 0) return activeMarket || null;
  const topic = String(topicRaw || "").trim();
  if (!topic) return activeMarket || markets[0];

  const tokens = topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

  if (tokens.length === 0) return activeMarket || markets[0];

  let best = markets[0];
  let bestScore = -1;
  for (const m of markets) {
    const q = `${m.question || ""} ${m.slug || ""}`.toLowerCase();
    let score = 0;
    for (const tok of tokens) {
      if (q.includes(tok)) score += 3;
      if (tok === "fed" && /\b(fed|fomc|rate|rates|interest)\b/.test(q)) score += 6;
      if ((tok === "btc" || tok === "bitcoin") && /\b(btc|bitcoin)\b/.test(q)) score += 6;
      if ((tok === "eth" || tok === "ethereum") && /\b(eth|ethereum)\b/.test(q)) score += 6;
      if ((tok === "sol" || tok === "solana") && /\b(sol|solana)\b/.test(q)) score += 6;
    }
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return bestScore > 0 ? best : activeMarket || markets[0];
}

/**
 * Parse a spoken or typed G2 voice command into a structured Paper Perp Order
 * or Polymarket Paper Bet intent. Returns `null` for conversational Telegram replies.
 */
export function parseVoiceTradeIntent(
  transcript,
  { perps = [], markets = [], activeMarket = null } = {}
) {
  const clean = String(transcript || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;

  // 1. Polymarket Paper Bet:
  //    - "Bet Yes 50 on Fed" / "Bet $50 Yes on Bitcoin" / "Buy No 25 on ETH ETF" / "Bet Yes 50"
  const betOutcomeFirst = clean.match(
    /^(?:please\s+)?(?:place\s+)?(?:a\s+)?(?:bet|wager|stake|buy|back)\s+(yes|no)(?:\s+\$?(\d+(?:\.\d+)?)(k)?(?:\s*(?:usdc|usd|dollars?|bucks))?)?(?:\s+(?:on|for)\s+(.+))?$/i
  );
  const betAmountFirst = clean.match(
    /^(?:please\s+)?(?:place\s+)?(?:a\s+)?(?:bet|wager|stake|buy|back)\s+\$?(\d+(?:\.\d+)?)(k)?(?:\s*(?:usdc|usd|dollars?|bucks))?\s+(yes|no)(?:\s+(?:on|for)\s+(.+))?$/i
  );

  if (betOutcomeFirst || betAmountFirst) {
    const outcome = (betOutcomeFirst ? betOutcomeFirst[1] : betAmountFirst[3]).toUpperCase();
    const amtStr = betOutcomeFirst ? betOutcomeFirst[2] : betAmountFirst[1];
    const kSuffix = betOutcomeFirst ? betOutcomeFirst[3] : betAmountFirst[2];
    const topic = (betOutcomeFirst ? betOutcomeFirst[4] : betAmountFirst[4]) || "";
    const stakeUsd = amtStr ? parseAmountToken(amtStr, kSuffix) : 50;
    const market = findBestPolymarket(topic, markets, activeMarket);
    if (!market) return null;

    const yesPct = Math.max(1, Math.min(99, Math.round(Number(market.yesPct) || 50)));
    const entryOddsPct = outcome === "YES" ? yesPct : 100 - yesPct;
    const entryPrice = entryOddsPct / 100;
    const shares = Number((stakeUsd / entryPrice).toFixed(2));
    const maxPayoutUsd = Number(shares.toFixed(2));

    return {
      kind: "PAPER_BET",
      outcome,
      stakeUsd,
      marketId: market.id,
      question: market.question,
      entryOddsPct,
      entryPrice,
      shares,
      maxPayoutUsd,
      rawTranscript: clean,
      summaryShort: truncateAscii(`BET ${outcome} $${stakeUsd} @${entryOddsPct}%`, 26),
    };
  }

  // 2. Hyperliquid Paper Perp Order:
  //    - "Long BTC 100" / "Short ETH $250 5x" / "Go long SOL 150 at 3x" / "Buy $200 BTC"
  const perpCoinFirst = clean.match(
    /^(?:please\s+)?(?:go\s+|open\s+)?(long|short|buy|sell)\s+([a-z0-9]{2,12})(?:\s+(?:perp|perps))?(?:\s+(?:for|size)?\s*\$?(\d+(?:\.\d+)?)(k)?(?:\s*(?:usdc|usd|dollars?))?)?(?:\s+(?:at\s+)?(\d+(?:\.\d+)?)x)?$/i
  );
  const perpAmtFirst = clean.match(
    /^(?:please\s+)?(?:go\s+|open\s+)?(long|short|buy|sell)\s+\$?(\d+(?:\.\d+)?)(k)?(?:\s*(?:usdc|usd|dollars?))?\s+(?:of\s+)?([a-z0-9]{2,12})(?:\s+(?:perp|perps))?(?:\s+(?:at\s+)?(\d+(?:\.\d+)?)x)?$/i
  );

  const m = perpCoinFirst || perpAmtFirst;
  if (m) {
    const verb = m[1].toLowerCase();
    const coinRaw = perpCoinFirst ? m[2] : m[4];
    const amtStr = perpCoinFirst ? m[3] : m[2];
    const kSuffix = perpCoinFirst ? m[4] : m[3];
    const levStr = m[5];

    const coin = resolveCoinSymbol(coinRaw, perps);
    if (!coin) return null;

    const livePerp = (perps || []).find((p) => p.coin === coin);
    const entryPx = Number(livePerp?.markPx || 0);
    if (!Number.isFinite(entryPx) || entryPx <= 0) return null;

    const side = verb === "short" || verb === "sell" ? "SHORT" : "LONG";
    const sizeUsd = amtStr ? parseAmountToken(amtStr, kSuffix) : 100;
    const rawLev = levStr ? Math.round(Number(levStr)) : DEFAULT_PAPER_LEVERAGE;
    const leverage = Math.max(1, Math.min(20, Number.isFinite(rawLev) ? rawLev : DEFAULT_PAPER_LEVERAGE));
    const marginUsd = Number((sizeUsd / leverage).toFixed(2));
    const qty = sizeUsd / entryPx;

    return {
      kind: "PAPER_PERP",
      side,
      coin,
      sizeUsd,
      leverage,
      marginUsd,
      entryPx,
      qty,
      rawTranscript: clean,
      summaryShort: truncateAscii(`${side} ${coin} $${sizeUsd} ${leverage}x`, 26),
    };
  }

  return null;
}

export function createDefaultPaperBook(startingCash = DEFAULT_PAPER_STARTING_CASH) {
  return {
    startingCash,
    cashUsd: startingCash,
    realizedPnlUsd: 0,
    perpOrders: [],
    polyBets: [],
    history: [],
  };
}

export function normalizePaperBook(raw) {
  const base = createDefaultPaperBook();
  if (!raw || typeof raw !== "object") return base;
  const startingCash = Number(raw.startingCash);
  const cashUsd = Number(raw.cashUsd);
  const realizedPnlUsd = Number(raw.realizedPnlUsd);
  return {
    startingCash: Number.isFinite(startingCash) && startingCash > 0 ? startingCash : base.startingCash,
    cashUsd: Number.isFinite(cashUsd) && cashUsd >= 0 ? cashUsd : base.cashUsd,
    realizedPnlUsd: Number.isFinite(realizedPnlUsd) ? realizedPnlUsd : 0,
    perpOrders: Array.isArray(raw.perpOrders) ? raw.perpOrders.slice(0, 24) : [],
    polyBets: Array.isArray(raw.polyBets) ? raw.polyBets.slice(0, 24) : [],
    history: Array.isArray(raw.history) ? raw.history.slice(0, 30) : [],
  };
}

/**
 * Execute a parsed Paper Perp Order or Polymarket Paper Bet against the non-custodial ledger.
 */
export function executePaperIntent(bookInput, intent, nowMs = Date.now()) {
  const book = normalizePaperBook(bookInput);
  if (!intent || (intent.kind !== "PAPER_PERP" && intent.kind !== "PAPER_BET")) {
    return { ok: false, book, error: "Unsupported paper trade intent" };
  }

  const tsId = `${nowMs}-${Math.floor(Math.random() * 1000)}`;

  if (intent.kind === "PAPER_PERP") {
    const marginUsd = Number((intent.sizeUsd / intent.leverage).toFixed(2));
    if (book.cashUsd + 1e-6 < marginUsd) {
      return {
        ok: false,
        book,
        error: `Insufficient paper cash ($${book.cashUsd.toFixed(0)} < $${marginUsd.toFixed(0)} mgn)`,
      };
    }
    const record = {
      id: `perp-${tsId}`,
      kind: "PAPER_PERP",
      coin: intent.coin,
      side: intent.side,
      sizeUsd: intent.sizeUsd,
      leverage: intent.leverage,
      marginUsd,
      entryPx: intent.entryPx,
      qty: intent.sizeUsd / intent.entryPx,
      openedAt: nowMs,
    };
    const nextBook = {
      ...book,
      cashUsd: Number((book.cashUsd - marginUsd).toFixed(2)),
      perpOrders: [record, ...book.perpOrders].slice(0, 24),
      history: [
        {
          id: record.id,
          timeMs: nowMs,
          action: "OPEN",
          kind: "PAPER_PERP",
          summary: `${record.side} ${record.coin} $${record.sizeUsd} ${record.leverage}x @ $${formatPrice(record.entryPx)}`,
        },
        ...book.history,
      ].slice(0, 30),
    };
    return { ok: true, book: nextBook, record };
  }

  // PAPER_BET
  const stakeUsd = Number(intent.stakeUsd);
  if (book.cashUsd + 1e-6 < stakeUsd) {
    return {
      ok: false,
      book,
      error: `Insufficient paper cash ($${book.cashUsd.toFixed(0)} < $${stakeUsd.toFixed(0)})`,
    };
  }
  const record = {
    id: `bet-${tsId}`,
    kind: "PAPER_BET",
    marketId: intent.marketId,
    question: intent.question,
    outcome: intent.outcome,
    stakeUsd,
    entryOddsPct: intent.entryOddsPct,
    entryPrice: intent.entryPrice,
    shares: intent.shares,
    maxPayoutUsd: intent.maxPayoutUsd,
    openedAt: nowMs,
  };
  const nextBook = {
    ...book,
    cashUsd: Number((book.cashUsd - stakeUsd).toFixed(2)),
    polyBets: [record, ...book.polyBets].slice(0, 24),
    history: [
      {
        id: record.id,
        timeMs: nowMs,
        action: "BET",
        kind: "PAPER_BET",
        summary: `${record.outcome} $${record.stakeUsd} @${record.entryOddsPct}% — ${truncateAscii(record.question, 34)}`,
      },
      ...book.history,
    ].slice(0, 30),
  };
  return { ok: true, book: nextBook, record };
}

/**
 * Compute live mark-to-market uPnL across all open paper perp positions and Polymarket bets
 * using current live Hyperliquid prices and live Polymarket YES/NO odds.
 */
export function computePaperPortfolioMetrics(bookInput, { perps = [], markets = [] } = {}) {
  const book = normalizePaperBook(bookInput);
  const perpByCoin = new Map((perps || []).map((p) => [String(p.coin).toUpperCase(), p]));
  const marketById = new Map((markets || []).map((m) => [String(m.id), m]));

  let lockedMarginUsd = 0;
  let unrealizedPnlUsd = 0;

  const enrichedPerps = book.perpOrders.map((pos) => {
    const live = perpByCoin.get(String(pos.coin).toUpperCase());
    const currentPx = Number(live?.markPx || pos.entryPx);
    const diff = pos.side === "LONG" ? currentPx - pos.entryPx : pos.entryPx - currentPx;
    const uPnlUsd = Number((diff * pos.qty).toFixed(2));
    const roePct = pos.marginUsd > 0 ? Number(((uPnlUsd / pos.marginUsd) * 100).toFixed(1)) : 0;
    lockedMarginUsd += pos.marginUsd;
    unrealizedPnlUsd += uPnlUsd;
    return {
      ...pos,
      currentPx,
      uPnlUsd,
      roePct,
    };
  });

  const enrichedBets = book.polyBets.map((bet) => {
    const live = marketById.get(String(bet.marketId));
    const liveYesPct = live
      ? Math.max(1, Math.min(99, Math.round(Number(live.yesPct) || 50)))
      : bet.outcome === "YES"
        ? bet.entryOddsPct
        : 100 - bet.entryOddsPct;
    const currentOddsPct = bet.outcome === "YES" ? liveYesPct : 100 - liveYesPct;
    const currentValueUsd = Number((bet.shares * (currentOddsPct / 100)).toFixed(2));
    const uPnlUsd = Number((currentValueUsd - bet.stakeUsd).toFixed(2));
    const roiPct = bet.stakeUsd > 0 ? Number(((uPnlUsd / bet.stakeUsd) * 100).toFixed(1)) : 0;
    lockedMarginUsd += bet.stakeUsd;
    unrealizedPnlUsd += uPnlUsd;
    return {
      ...bet,
      currentOddsPct,
      currentValueUsd,
      uPnlUsd,
      roiPct,
    };
  });

  const totalEquityUsd = Number((book.cashUsd + lockedMarginUsd + unrealizedPnlUsd).toFixed(2));

  return {
    startingCash: book.startingCash,
    cashUsd: Number(book.cashUsd.toFixed(2)),
    lockedMarginUsd: Number(lockedMarginUsd.toFixed(2)),
    unrealizedPnlUsd: Number(unrealizedPnlUsd.toFixed(2)),
    realizedPnlUsd: Number(book.realizedPnlUsd.toFixed(2)),
    totalEquityUsd,
    openCount: enrichedPerps.length + enrichedBets.length,
    perps: enrichedPerps,
    bets: enrichedBets,
  };
}

/**
 * Close an open paper perp order or Polymarket paper bet at current live mark/odds.
 */
export function closePaperPosition(bookInput, id, { perps = [], markets = [] } = {}, nowMs = Date.now()) {
  const book = normalizePaperBook(bookInput);
  const metrics = computePaperPortfolioMetrics(book, { perps, markets });

  const perpHit = metrics.perps.find((p) => p.id === id);
  if (perpHit) {
    const returnedCash = Math.max(0, Number((perpHit.marginUsd + perpHit.uPnlUsd).toFixed(2)));
    const realizedDelta = Number((returnedCash - perpHit.marginUsd).toFixed(2));
    const nextBook = {
      ...book,
      cashUsd: Number((book.cashUsd + returnedCash).toFixed(2)),
      realizedPnlUsd: Number((book.realizedPnlUsd + realizedDelta).toFixed(2)),
      perpOrders: book.perpOrders.filter((p) => p.id !== id),
      history: [
        {
          id: `close-${id}`,
          timeMs: nowMs,
          action: "CLOSE",
          kind: "PAPER_PERP",
          summary: `Closed ${perpHit.side} ${perpHit.coin} @ $${formatPrice(perpHit.currentPx)} (${formatSignedUsd(realizedDelta)})`,
        },
        ...book.history,
      ].slice(0, 30),
    };
    return { ok: true, book: nextBook, closed: perpHit, realizedPnlUsd: realizedDelta };
  }

  const betHit = metrics.bets.find((b) => b.id === id);
  if (betHit) {
    const returnedCash = Math.max(0, betHit.currentValueUsd);
    const realizedDelta = Number((returnedCash - betHit.stakeUsd).toFixed(2));
    const nextBook = {
      ...book,
      cashUsd: Number((book.cashUsd + returnedCash).toFixed(2)),
      realizedPnlUsd: Number((book.realizedPnlUsd + realizedDelta).toFixed(2)),
      polyBets: book.polyBets.filter((b) => b.id !== id),
      history: [
        {
          id: `close-${id}`,
          timeMs: nowMs,
          action: "CLOSE",
          kind: "PAPER_BET",
          summary: `Closed ${betHit.outcome} @${betHit.currentOddsPct}% (${formatSignedUsd(realizedDelta)})`,
        },
        ...book.history,
      ].slice(0, 30),
    };
    return { ok: true, book: nextBook, closed: betHit, realizedPnlUsd: realizedDelta };
  }

  return { ok: false, book, error: "Paper position not found" };
}
