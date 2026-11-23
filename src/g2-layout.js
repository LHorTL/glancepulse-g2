/**
 * Even Realities G2 576x288 Focus-Card HUD Page Builder (v2.0).
 *
 * Strictly engineered for physical Even G2 waveguide hardware & LVGL firmware:
 *   - Canvas: 576 x 288 px (4-bit monochrome green micro-LED)
 *   - Fixed ~21px G2 system font budgets:
 *       * Full-width header/footer (560px): <= 38 chars, 1 line
 *       * Left Focus/Detail card (368x116): <= 26 chars/line, <= 3 lines (zero clipping!)
 *       * Right KPI strip (184x30): <= 15 chars, 1 line
 *       * Main Action/Data List (560x98): <= 36 chars/row
 *   - `borderColor` uses true 0..15 grayscale scale (10 = crisp visible hairline)
 *   - `textColor` uses firmware 0..4 brightness scale
 *   - Uses `ImageContainerProperty` (184x84, within 20..288 x 20..144) + `ImageRawDataUpdate`
 *   - Every page container passes `validateEvenHubPageContainer` before returning
 */

import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ListContainerProperty,
  ListItemContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  validateEvenHubPageContainer,
  formatEvenHubPageContainerValidationError,
} from "@evenrealities/even_hub_sdk";
import {
  buildSmartReplies,
  extractMarketContext,
  formatCompactUsd,
  formatPrice,
  formatSignedPct,
  truncateAscii,
} from "./feeds.js";
import {
  SPARK_IMG_HEIGHT,
  SPARK_IMG_WIDTH,
  renderMicWaveformImage,
  renderProbabilityBarImage,
  renderSparklineImage,
} from "./graphics.js";

export const G2_WIDTH = 576;
export const G2_HEIGHT = 288;

export const SCREENS = ["FOCUS", "PERPS", "MARKETS", "VOICE"];

export const CONTAINER_IDS = {
  HEADER: 1,
  DETAIL_CARD: 2,
  SPARK_IMG: 3,
  MARKET_KPI: 4,
  MAIN_LIST: 5,
  FOOTER: 6,
};

export const G2_TEXT_LIMITS = {
  HEADER_CHARS: 38,
  CARD_LINE_CHARS: 26,
  CARD_MAX_LINES: 3,
  KPI_CHARS: 15,
  LIST_ITEM_CHARS: 36,
  FOOTER_CHARS: 38,
};

export const MENU_ACTION_IDS = {
  SCREEN_FOCUS: 101,
  SCREEN_PERPS: 102,
  SCREEN_MARKETS: 103,
  SCREEN_VOICE: 104,
  NEXT_MSG: 105,
  TOGGLE_VOICE: 106,
  ARM_ALERT: 107,
  SEND_PULSE_TG: 108,
  REFRESH_FEEDS: 109,
};

export function buildContextMenu() {
  return new MenuContainerProperty({
    menuItems: [
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.SCREEN_FOCUS, itemName: "Focus Card" }),
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.SCREEN_VOICE, itemName: "Voice Reply" }),
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.SCREEN_PERPS, itemName: "Hyperliquid Perps" }),
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.SCREEN_MARKETS, itemName: "Polymarket Odds" }),
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.NEXT_MSG, itemName: "Next Telegram Msg" }),
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.TOGGLE_VOICE, itemName: "Start/Stop Mic" }),
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.ARM_ALERT, itemName: "Arm Alert" }),
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.SEND_PULSE_TG, itemName: "Push Pulse to TG" }),
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.REFRESH_FEEDS, itemName: "Sync Live Feeds" }),
    ],
  });
}

/**
 * Word-wrap text strictly into `maxLines` lines of at most `maxCols` chars each.
 */
export function wrapLinesToBudget(text, maxCols = G2_TEXT_LIMITS.CARD_LINE_CHARS, maxLines = 2) {
  const words = String(text ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  if (words.length === 0) return [""];

  const lines = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length <= maxCols) {
      cur = candidate;
    } else {
      if (cur) lines.push(cur);
      if (lines.length >= maxLines - 1) {
        const rest = [w, ...words.slice(i + 1)].join(" ");
        lines.push(truncateAscii(rest, maxCols));
        return lines.slice(0, maxLines);
      }
      cur = truncateAscii(w, maxCols);
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.slice(0, maxLines);
}

export function getActiveMessage(state) {
  const msgs = state?.messages || [];
  if (msgs.length === 0) return null;
  const idx = Math.max(0, Math.min(state.messageIndex || 0, msgs.length - 1));
  return msgs[idx];
}

export function getFocusContext(state) {
  const msg = getActiveMessage(state);
  return extractMarketContext(msg, {
    perps: state?.perps || [],
    markets: state?.markets || [],
    candlesByCoin: state?.candlesByCoin || {},
  });
}

export function formatHeaderLine(state) {
  const now = new Date(state.nowMs || Date.now());
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const live = state.hlSource === "LIVE" || state.pmSource === "LIVE" ? "LIVE" : "DEMO";
  const tg = state.tgSource === "LIVE" ? "TG:ON" : "TG:SIM";
  const batt = state.batteryLevel != null ? `${state.batteryLevel}%` : "G2";

  if (state.voiceRecording) {
    const role = String(state.voiceSpeakerRole || "self").toUpperCase().slice(0, 4);
    return truncateAscii(`REC [${state.screen}] MIC:${role} ${hh}:${mm} ${batt}`, G2_TEXT_LIMITS.HEADER_CHARS);
  }
  if (state.pendingReply) {
    const imuTag = state.imuActive ? "IMU:ON" : "CONFIRM";
    return truncateAscii(`CONFIRM [${imuTag}] ${hh}:${mm} ${tg}`, G2_TEXT_LIMITS.HEADER_CHARS);
  }
  return truncateAscii(`GLANCE [${state.screen}] ${hh}:${mm} ${live} ${tg}`, G2_TEXT_LIMITS.HEADER_CHARS);
}

export function getListItemsForState(state) {
  switch (state.screen) {
    case "FOCUS": {
      if (state.pendingReply) {
        return [
          truncateAscii("Confirm & Send Reply (Tap/Nod)", G2_TEXT_LIMITS.LIST_ITEM_CHARS),
          truncateAscii("Re-Record Voice Reply", G2_TEXT_LIMITS.LIST_ITEM_CHARS),
          truncateAscii("Cancel Draft (Shake/2xTap)", G2_TEXT_LIMITS.LIST_ITEM_CHARS),
        ];
      }
      const msg = getActiveMessage(state);
      const ctx = getFocusContext(state);
      const smart = buildSmartReplies(msg, ctx, state);
      const total = Math.max(1, (state.messages || []).length);
      const nextNum = ((state.messageIndex || 0) + 1) % total + 1;
      return [
        truncateAscii(state.voiceRecording ? "Stop Mic & Draft Reply" : "Voice Reply (Hold Ring/R)", G2_TEXT_LIMITS.LIST_ITEM_CHARS),
        truncateAscii(`Reply: ${smart[0].label}`, G2_TEXT_LIMITS.LIST_ITEM_CHARS),
        truncateAscii(`Reply: ${smart[1].label}`, G2_TEXT_LIMITS.LIST_ITEM_CHARS),
        truncateAscii(`Next Msg (${nextNum}/${total})`, G2_TEXT_LIMITS.LIST_ITEM_CHARS),
        truncateAscii(`Reply: ${smart[2].label}`, G2_TEXT_LIMITS.LIST_ITEM_CHARS),
      ];
    }

    case "PERPS":
      return (state.perps || []).slice(0, 6).map((p) => {
        const armed = (state.alerts || []).some((a) => a.kind === "perp" && a.target === p.coin);
        const flag = armed ? "*" : " ";
        return truncateAscii(
          `${flag}${p.coin.padEnd(4)} $${formatPrice(p.markPx).padEnd(7)} ${formatSignedPct(p.change24h).padEnd(6)} F:${p.fundingApr}%`,
          G2_TEXT_LIMITS.LIST_ITEM_CHARS
        );
      });

    case "MARKETS":
      return (state.markets || []).slice(0, 6).map((m) => {
        const armed = (state.alerts || []).some((a) => a.kind === "polymarket" && a.target === m.id);
        const flag = armed ? "*" : "";
        return truncateAscii(`${flag}${String(m.yesPct).padStart(2)}% YES | ${m.question}`, G2_TEXT_LIMITS.LIST_ITEM_CHARS);
      });

    case "VOICE": {
      const hasDraft = Boolean(state.pendingReply?.text);
      return [
        truncateAscii(
          state.voiceRecording ? "Stop Mic & Preview Draft" : hasDraft ? "Confirm & Send to Telegram" : "Start G2 Mic Recording",
          G2_TEXT_LIMITS.LIST_ITEM_CHARS
        ),
        truncateAscii("Re-Record Voice Reply", G2_TEXT_LIMITS.LIST_ITEM_CHARS),
        truncateAscii("Append Live Market Context", G2_TEXT_LIMITS.LIST_ITEM_CHARS),
        truncateAscii("Cancel & Return to Focus", G2_TEXT_LIMITS.LIST_ITEM_CHARS),
      ];
    }

    default:
      return ["GlancePulse Ready"];
  }
}

export function deriveToastHeading(toastMsg) {
  const s = String(toastMsg || "");
  if (/\b(err|error|fail|failed|blocked)\b/i.test(s)) return "ERROR";
  if (/\b(cancel|canceled|cancelled|disarm|disarmed)\b/i.test(s)) return "CANCELED";
  if (/\b(sync|synced|connected|ready)\b/i.test(s)) return "NOTICE";
  return "CONFIRMED";
}

export function buildDetailTextForScreen(state) {
  const lim = G2_TEXT_LIMITS.CARD_LINE_CHARS;

  if (state.toast) {
    const wrapped = wrapLinesToBudget(state.toast, lim, 2);
    return [truncateAscii(deriveToastHeading(state.toast), lim), ...wrapped].slice(0, G2_TEXT_LIMITS.CARD_MAX_LINES).join("\n");
  }

  if (state.pendingReply && (state.screen === "FOCUS" || state.screen === "VOICE")) {
    const target = truncateAscii(`TO ${state.pendingReply.targetLabel || "Telegram"}`, lim);
    const preview = String(state.pendingReply.text || "").replace(/^\[G2(?: Voice)?\]\s*/i, "");
    const body = wrapLinesToBudget(`"${preview}"`, lim, 2);
    return [target, ...body].slice(0, G2_TEXT_LIMITS.CARD_MAX_LINES).join("\n");
  }

  if (state.voiceRecording) {
    const role = String(state.voiceSpeakerRole || "self").toUpperCase();
    const partial = state.voiceTranscript || "Speak now (G2 16kHz mic)...";
    const lines = wrapLinesToBudget(partial, lim, 2);
    return [truncateAscii(`LISTENING (${role})`, lim), ...lines].slice(0, G2_TEXT_LIMITS.CARD_MAX_LINES).join("\n");
  }

  switch (state.screen) {
    case "FOCUS": {
      const msg = getActiveMessage(state);
      if (!msg) return "No Telegram messages.\nConnect bot or tap Sync.";
      const total = (state.messages || []).length;
      const num = (state.messageIndex || 0) + 1;
      const badge = msg.kind === "CHANNEL" ? "CH" : "TG";
      const header = truncateAscii(`${badge} ${msg.from} ${num}/${total}`, lim);
      const bodyLines = wrapLinesToBudget(msg.text, lim, 2);
      return [header, ...bodyLines].slice(0, G2_TEXT_LIMITS.CARD_MAX_LINES).join("\n");
    }

    case "PERPS": {
      const idx = state.selectedIndex || 0;
      const p = state.perps?.[idx] || state.perps?.[0];
      if (!p) return "No Hyperliquid data.";
      const armed = (state.alerts || []).some((a) => a.kind === "perp" && a.target === p.coin);
      return [
        truncateAscii(`${p.coin}-PERP $${formatPrice(p.markPx)}`, lim),
        truncateAscii(`24h ${formatSignedPct(p.change24h)}  OI ${formatCompactUsd(p.openInterestUsd)}`, lim),
        truncateAscii(`Fund ${p.fundingApr}%  Alrt:${armed ? "ON" : "OFF"}`, lim),
      ].join("\n");
    }

    case "MARKETS": {
      const idx = state.selectedIndex || 0;
      const m = state.markets?.[idx] || state.markets?.[0];
      if (!m) return "No Polymarket data.";
      const armed = (state.alerts || []).some((a) => a.kind === "polymarket" && a.target === m.id);
      const qLines = wrapLinesToBudget(m.question, lim, 2);
      const meta = truncateAscii(`24h ${formatSignedPct(m.deltaPct)}  Alrt:${armed ? "ON" : "OFF"}`, lim);
      return [...qLines, meta].slice(0, G2_TEXT_LIMITS.CARD_MAX_LINES).join("\n");
    }

    case "VOICE": {
      const msg = getActiveMessage(state);
      const toLine = truncateAscii(`REPLY -> ${msg?.from || "Telegram"}`, lim);
      const tip = wrapLinesToBudget("Hold R1 ring or tap Start Mic to dictate.", lim, 2);
      return [toLine, ...tip].slice(0, G2_TEXT_LIMITS.CARD_MAX_LINES).join("\n");
    }

    default:
      return "GlancePulse Ready";
  }
}

export function buildKpiLineForScreen(state) {
  const lim = G2_TEXT_LIMITS.KPI_CHARS;

  if (state.voiceRecording) {
    return truncateAscii(`REC ${state.voiceSeconds || 0}s MIC`, lim);
  }
  if (state.pendingReply) {
    return truncateAscii(state.imuActive ? "NOD:OK SHK:NO" : "TAP TO SEND", lim);
  }

  switch (state.screen) {
    case "FOCUS": {
      const ctx = getFocusContext(state);
      return truncateAscii(ctx.kpiShort, lim);
    }
    case "PERPS": {
      const p = state.perps?.[state.selectedIndex || 0] || state.perps?.[0];
      return truncateAscii(p ? `APR ${p.fundingApr}%` : "HL PERP", lim);
    }
    case "MARKETS": {
      const m = state.markets?.[state.selectedIndex || 0] || state.markets?.[0];
      return truncateAscii(m ? `VOL ${formatCompactUsd(m.volume24h)}` : "POLYMARKET", lim);
    }
    case "VOICE":
      return truncateAscii(state.imuActive ? "IMU READY" : "HOLD TO TALK", lim);
    default:
      return "G2 READY";
  }
}

export function buildFooterLine(state) {
  if (state.pendingReply) {
    return truncateAscii("Tap/Nod:Send  2xTap/Shake:Cancel", G2_TEXT_LIMITS.FOOTER_CHARS);
  }
  if (state.voiceRecording) {
    return truncateAscii("Release Ring/Temple to draft reply", G2_TEXT_LIMITS.FOOTER_CHARS);
  }
  if (state.screen === "FOCUS") {
    return truncateAscii("Tap:Act  Hold:Voice  2xTap:Next  M:Menu", G2_TEXT_LIMITS.FOOTER_CHARS);
  }
  if (state.screen === "PERPS" || state.screen === "MARKETS") {
    return truncateAscii("Tap:Alert  Hold:Voice  2xTap:TG  M:Menu", G2_TEXT_LIMITS.FOOTER_CHARS);
  }
  return truncateAscii("Tap:Send  Hold:Mic  2xTap:Focus  M:Menu", G2_TEXT_LIMITS.FOOTER_CHARS);
}

/**
 * Generate the 4-bit grayscale graphic (`{ width, height, pixels, pngBytes }`)
 * corresponding to the current G2 screen/state.
 */
export function buildGraphicForState(state) {
  if (state.voiceRecording || state.screen === "VOICE") {
    return renderMicWaveformImage(state.audioLevels || [], {
      width: SPARK_IMG_WIDTH,
      height: SPARK_IMG_HEIGHT,
      active: Boolean(state.voiceRecording),
      roleLabel: state.voiceRecording
        ? String(state.voiceSpeakerRole || "SELF").toUpperCase()
        : state.pendingReply
          ? "CONFIRM"
          : "READY",
    });
  }

  if (state.screen === "MARKETS") {
    const m = state.markets?.[state.selectedIndex || 0] || state.markets?.[0];
    return renderProbabilityBarImage(m?.yesPct ?? 50, {
      width: SPARK_IMG_WIDTH,
      height: SPARK_IMG_HEIGHT,
      deltaText: m ? formatSignedPct(m.deltaPct) : "",
    });
  }

  if (state.screen === "PERPS") {
    const p = state.perps?.[state.selectedIndex || 0] || state.perps?.[0];
    const candles = (p && state.candlesByCoin?.[p.coin]) || [];
    return renderSparklineImage(candles, {
      width: SPARK_IMG_WIDTH,
      height: SPARK_IMG_HEIGHT,
      tag: p ? `${p.coin} 24H` : "24H",
      deltaText: p ? formatSignedPct(p.change24h) : "",
    });
  }

  // FOCUS screen: render entity-linked Polymarket gauge OR Hyperliquid 24h sparkline!
  const ctx = getFocusContext(state);
  if (ctx.kind === "polymarket" && ctx.market) {
    return renderProbabilityBarImage(ctx.market.yesPct, {
      width: SPARK_IMG_WIDTH,
      height: SPARK_IMG_HEIGHT,
      deltaText: formatSignedPct(ctx.market.deltaPct),
    });
  }
  const p = ctx.perp;
  return renderSparklineImage(ctx.candles, {
    width: SPARK_IMG_WIDTH,
    height: SPARK_IMG_HEIGHT,
    tag: p ? `${p.coin} 24H` : "24H",
    deltaText: p ? formatSignedPct(p.change24h) : "",
  });
}

/**
 * Construct a protocol-validated EvenHub SDK page container (`CreateStartUpPageContainer`
 * or `RebuildPageContainer`) with 6 non-overlapping containers (4 text, 1 list, 1 image).
 */
export function buildG2PagePayload(state, { isStartup = false } = {}) {
  const listItems = getListItemsForState(state);

  const header = new TextContainerProperty({
    containerID: CONTAINER_IDS.HEADER,
    containerName: "hdr_bar",
    xPosition: 8,
    yPosition: 2,
    width: 560,
    height: 32,
    borderWidth: 0,
    borderColor: 0,
    borderRadius: 0,
    paddingLength: 2,
    isEventCapture: 0,
    zOrderIndex: 1,
    textColor: 4,
    content: formatHeaderLine(state),
  });

  const detailCard = new TextContainerProperty({
    containerID: CONTAINER_IDS.DETAIL_CARD,
    containerName: "detail_card",
    xPosition: 8,
    yPosition: 38,
    width: 368,
    height: 116,
    borderWidth: 1,
    borderColor: 10, // 0..15 4-bit grayscale scale (crisp visible border on G2)
    borderRadius: 4,
    paddingLength: 4,
    isEventCapture: 0,
    zOrderIndex: 2,
    textColor: 4,
    content: buildDetailTextForScreen(state),
  });

  const sparkImg = new ImageContainerProperty({
    containerID: CONTAINER_IDS.SPARK_IMG,
    containerName: "spark_img",
    xPosition: 384,
    yPosition: 38,
    width: SPARK_IMG_WIDTH,
    height: SPARK_IMG_HEIGHT,
    zOrderIndex: 3,
  });

  const marketKpi = new TextContainerProperty({
    containerID: CONTAINER_IDS.MARKET_KPI,
    containerName: "market_kpi",
    xPosition: 384,
    yPosition: 124,
    width: SPARK_IMG_WIDTH,
    height: 30,
    borderWidth: 1,
    borderColor: 8,
    borderRadius: 3,
    paddingLength: 2,
    isEventCapture: 0,
    zOrderIndex: 4,
    textColor: 3,
    content: buildKpiLineForScreen(state),
  });

  const mainList = new ListContainerProperty({
    containerID: CONTAINER_IDS.MAIN_LIST,
    containerName: "main_list",
    xPosition: 8,
    yPosition: 158,
    width: 560,
    height: 98,
    borderWidth: 1,
    borderColor: 10,
    borderRadius: 4,
    paddingLength: 4,
    isEventCapture: 1,
    zOrderIndex: 5,
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 544,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
  });

  const footer = new TextContainerProperty({
    containerID: CONTAINER_IDS.FOOTER,
    containerName: "footer_bar",
    xPosition: 8,
    yPosition: 258,
    width: 560,
    height: 28,
    borderWidth: 0,
    borderColor: 0,
    borderRadius: 0,
    paddingLength: 2,
    isEventCapture: 0,
    zOrderIndex: 6,
    textColor: 2,
    content: buildFooterLine(state),
  });

  const payloadFields = {
    containerTotalNum: 6,
    listObject: [mainList],
    textObject: [header, detailCard, marketKpi, footer],
    imageObject: [sparkImg],
    menuObject: buildContextMenu(),
  };

  const validation = validateEvenHubPageContainer(payloadFields);
  if (!validation.valid) {
    throw new Error(`Invalid G2 page container: ${formatEvenHubPageContainerValidationError(validation)}`);
  }

  return isStartup
    ? new CreateStartUpPageContainer(payloadFields)
    : new RebuildPageContainer(payloadFields);
}

/**
 * Flicker-free incremental container upgrades (`textContainerUpgrade` & `updateImageRawData`).
 */
export function buildHeaderUpgrade(state) {
  const content = formatHeaderLine(state);
  return new TextContainerUpgrade({
    containerID: CONTAINER_IDS.HEADER,
    containerName: "hdr_bar",
    contentOffset: 0,
    contentLength: content.length,
    content,
    textColor: 4,
  });
}

export function buildDetailUpgrade(state) {
  const content = buildDetailTextForScreen(state);
  return new TextContainerUpgrade({
    containerID: CONTAINER_IDS.DETAIL_CARD,
    containerName: "detail_card",
    contentOffset: 0,
    contentLength: content.length,
    content,
    textColor: state.toast || state.pendingReply ? 4 : 3,
  });
}

export function buildKpiUpgrade(state) {
  const content = buildKpiLineForScreen(state);
  return new TextContainerUpgrade({
    containerID: CONTAINER_IDS.MARKET_KPI,
    containerName: "market_kpi",
    contentOffset: 0,
    contentLength: content.length,
    content,
    textColor: state.voiceRecording || state.pendingReply ? 4 : 3,
  });
}

export function buildFooterUpgrade(state) {
  const content = buildFooterLine(state);
  return new TextContainerUpgrade({
    containerID: CONTAINER_IDS.FOOTER,
    containerName: "footer_bar",
    contentOffset: 0,
    contentLength: content.length,
    content,
    textColor: 2,
  });
}

export function buildImageUpdate(graphic) {
  return new ImageRawDataUpdate({
    containerID: CONTAINER_IDS.SPARK_IMG,
    containerName: "spark_img",
    imageData: Array.from(graphic.pngBytes),
  });
}
