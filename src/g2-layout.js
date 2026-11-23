/**
 * Even Realities G2 576x288 HUD Page Builder.
 *
 * Strictly constructs and validates SDK page containers against
 * `@evenrealities/even_hub_sdk` protocol rules:
 *   - Canvas: 576 x 288 px (monochrome 4-bit brightness 0..4)
 *   - containerTotalNum <= 12, textObject <= 8, menuItems <= 10 (<=32 UTF-8 bytes)
 *   - Explicit non-overlapping geometry & unique zOrderIndex per container
 */

import {
  CreateStartUpPageContainer,
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
import { formatCompactUsd, formatPrice, formatSignedPct, truncateAscii, QUICK_REPLIES } from "./feeds.js";

export const G2_WIDTH = 576;
export const G2_HEIGHT = 288;

export const SCREENS = ["PULSE", "POLYMARKET", "HYPERLIQUID", "TELEGRAM"];

export const CONTAINER_IDS = {
  HEADER: 1,
  MAIN_LIST: 2,
  DETAIL_CARD: 3,
  FOOTER: 4,
};

export const MENU_ACTION_IDS = {
  SCREEN_PULSE: 101,
  SCREEN_POLYMARKET: 102,
  SCREEN_HYPERLIQUID: 103,
  SCREEN_TELEGRAM: 104,
  REFRESH_FEEDS: 105,
  SEND_PULSE_TG: 106,
  ARM_ALERT: 107,
};

export function buildContextMenu() {
  return new MenuContainerProperty({
    menuItems: [
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.SCREEN_PULSE, itemName: "Pulse Overview" }),
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.SCREEN_POLYMARKET, itemName: "Polymarket Odds" }),
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.SCREEN_HYPERLIQUID, itemName: "Hyperliquid Perps" }),
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.SCREEN_TELEGRAM, itemName: "Telegram Replies" }),
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.ARM_ALERT, itemName: "Arm Alert" }),
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.SEND_PULSE_TG, itemName: "Push to Telegram" }),
      new MenuItemProperty({ itemID: MENU_ACTION_IDS.REFRESH_FEEDS, itemName: "Refresh Now" }),
    ],
  });
}

export function formatHeaderLine(state) {
  const now = new Date(state.nowMs || Date.now());
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const liveTag = state.hlSource === "LIVE" || state.pmSource === "LIVE" ? "LIVE" : "DEMO";
  const tgTag = state.tgSource === "LIVE" ? "TG:ON" : "TG:SIM";
  const alertsCount = (state.alerts || []).length;
  const batt = state.batteryLevel != null ? `${state.batteryLevel}%` : "G2";
  return `GLANCEPULSE [${state.screen}]  ${hh}:${mm}  ${liveTag} ${tgTag}  ALRT:${alertsCount}  ${batt}`;
}

function buildListItemsForScreen(state) {
  switch (state.screen) {
    case "PULSE": {
      const rows = [];
      for (const p of (state.perps || []).slice(0, 3)) {
        rows.push(
          truncateAscii(
            `${p.coin.padEnd(4)} $${formatPrice(p.markPx).padEnd(9)} ${formatSignedPct(p.change24h).padEnd(8)} APR ${p.fundingApr}%`,
            46
          )
        );
      }
      const pm = state.markets?.[0];
      if (pm) {
        rows.push(truncateAscii(`PM ${pm.yesPct}% YES | ${pm.question}`, 46));
      }
      const msg = state.messages?.[0];
      if (msg) {
        rows.push(truncateAscii(`TG ${msg.from}: ${msg.text}`, 46));
      }
      return rows.length ? rows : ["Loading live feeds..."];
    }

    case "POLYMARKET":
      return (state.markets || []).slice(0, 6).map((m) =>
        truncateAscii(`${String(m.yesPct).padStart(2)}% YES | ${m.question}`, 46)
      );

    case "HYPERLIQUID":
      return (state.perps || []).slice(0, 6).map((p) => {
        const armed = (state.alerts || []).some((a) => a.kind === "perp" && a.target === p.coin);
        const flag = armed ? "*" : " ";
        return truncateAscii(
          `${flag}${p.coin.padEnd(4)} $${formatPrice(p.markPx).padEnd(9)} ${formatSignedPct(p.change24h).padEnd(8)} F:${p.fundingApr}%`,
          46
        );
      });

    case "TELEGRAM": {
      const items = [];
      for (const q of QUICK_REPLIES) {
        items.push(truncateAscii(`[REPLY] ${q.label}`, 46));
      }
      for (const m of (state.messages || []).slice(0, 3)) {
        items.push(truncateAscii(`${m.time} ${m.from}: ${m.text}`, 46));
      }
      return items;
    }

    default:
      return ["GlancePulse Ready"];
  }
}

function buildDetailTextForScreen(state) {
  const idx = state.selectedIndex || 0;

  if (state.toast) {
    return `ACTION CONFIRMED\n${truncateAscii(state.toast, 120)}`;
  }

  switch (state.screen) {
    case "PULSE": {
      const topPerp = state.perps?.[0];
      const topPm = state.markets?.[0];
      const topMsg = state.messages?.[0];
      return [
        topPerp ? `Lead: ${topPerp.coin} $${formatPrice(topPerp.markPx)} (${formatSignedPct(topPerp.change24h)}, APR ${topPerp.fundingApr}%)` : "Lead: --",
        topPm ? `Top PM: ${topPm.yesPct}% YES (${formatCompactUsd(topPm.volume24h)} 24h)` : "Top PM: --",
        topMsg ? `Inbox: ${truncateAscii(topMsg.from + " - " + topMsg.text, 46)}` : "Inbox: empty",
        "Tap: open view | 2xTap: push TG | Hold: next tab",
      ].join("\n");
    }

    case "POLYMARKET": {
      const m = state.markets?.[idx] || state.markets?.[0];
      if (!m) return "No Polymarket data.";
      const armed = (state.alerts || []).some((a) => a.kind === "polymarket" && a.target === m.id);
      return [
        truncateAscii(m.question, 44),
        `YES: ${m.yesPct}%  NO: ${100 - m.yesPct}%  24h: ${formatSignedPct(m.deltaPct)}`,
        `24h Vol: ${formatCompactUsd(m.volume24h)}  Alert: ${armed ? "ARMED (+/-5%)" : "OFF"}`,
        "Tap: toggle alert | 2xTap: share to TG",
      ].join("\n");
    }

    case "HYPERLIQUID": {
      const p = state.perps?.[idx] || state.perps?.[0];
      if (!p) return "No Hyperliquid data.";
      const armed = (state.alerts || []).some((a) => a.kind === "perp" && a.target === p.coin);
      return [
        `${p.coin}-USD PERP  $${formatPrice(p.markPx)}`,
        `24h: ${formatSignedPct(p.change24h)} | Funding: ${p.fundingApr}% APR`,
        `Open Int: ${formatCompactUsd(p.openInterestUsd)} | Alert: ${armed ? "ARMED" : "OFF"}`,
        "Tap: arm +/-2% alert | 2xTap: send TG",
      ].join("\n");
    }

    case "TELEGRAM": {
      if (idx < QUICK_REPLIES.length) {
        const q = QUICK_REPLIES[idx];
        return [
          `QUICK REPLY -> ${state.tgSource === "LIVE" ? "LIVE BOT" : "SIM OUTBOX"}`,
          `Template: ${q.label}`,
          q.id === "pulse" ? "Sends live BTC/ETH/SOL + Top Polymarket" : truncateAscii(q.text, 48),
          "Tap: SEND NOW | Long-press: next screen",
        ].join("\n");
      }
      const m = state.messages?.[idx - QUICK_REPLIES.length];
      if (!m) return "Select a reply or message.";
      return [
        `FROM: ${m.from} (${m.time})`,
        truncateAscii(m.text, 96),
        "Scroll up for 1-tap Quick Replies",
      ].join("\n");
    }

    default:
      return "";
  }
}

export function buildFooterLine(state) {
  const screenIdx = SCREENS.indexOf(state.screen);
  const tabs = SCREENS.map((s, i) => (i === screenIdx ? `[${s}]` : s)).join(" ");
  return truncateAscii(`${tabs}  |  2xTap:TG  Hold:Tab`, 64);
}

/**
 * Construct a validated EvenHub SDK container payload for either initial
 * `createStartUpPageContainer` or subsequent `rebuildPageContainer`.
 */
export function buildG2PagePayload(state, { isStartup = false } = {}) {
  const listItems = buildListItemsForScreen(state);

  const header = new TextContainerProperty({
    containerID: CONTAINER_IDS.HEADER,
    containerName: "hdr_bar",
    xPosition: 8,
    yPosition: 4,
    width: 560,
    height: 30,
    borderWidth: 0,
    borderColor: 0,
    borderRadius: 0,
    paddingLength: 2,
    isEventCapture: 0,
    zOrderIndex: 1,
    textColor: 4,
    content: formatHeaderLine(state),
  });

  const mainList = new ListContainerProperty({
    containerID: CONTAINER_IDS.MAIN_LIST,
    containerName: "main_list",
    xPosition: 8,
    yPosition: 38,
    width: 560,
    height: 136,
    borderWidth: 1,
    borderColor: 2,
    borderRadius: 4,
    paddingLength: 4,
    isEventCapture: 1,
    zOrderIndex: 2,
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 544,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
  });

  const detailCard = new TextContainerProperty({
    containerID: CONTAINER_IDS.DETAIL_CARD,
    containerName: "detail_card",
    xPosition: 8,
    yPosition: 178,
    width: 560,
    height: 76,
    borderWidth: 1,
    borderColor: 1,
    borderRadius: 4,
    paddingLength: 4,
    isEventCapture: 0,
    zOrderIndex: 3,
    textColor: 3,
    content: buildDetailTextForScreen(state),
  });

  const footer = new TextContainerProperty({
    containerID: CONTAINER_IDS.FOOTER,
    containerName: "footer_tabs",
    xPosition: 8,
    yPosition: 258,
    width: 560,
    height: 26,
    borderWidth: 0,
    borderColor: 0,
    borderRadius: 0,
    paddingLength: 2,
    isEventCapture: 0,
    zOrderIndex: 4,
    textColor: 2,
    content: buildFooterLine(state),
  });

  const payloadFields = {
    containerTotalNum: 4,
    listObject: [mainList],
    textObject: [header, detailCard, footer],
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
 * Fast flicker-free header/detail incremental text update via `textContainerUpgrade`.
 */
export function buildDetailUpgrade(state) {
  const content = buildDetailTextForScreen(state);
  return new TextContainerUpgrade({
    containerID: CONTAINER_IDS.DETAIL_CARD,
    containerName: "detail_card",
    contentOffset: 0,
    contentLength: content.length,
    content,
    textColor: state.toast ? 4 : 3,
  });
}

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
