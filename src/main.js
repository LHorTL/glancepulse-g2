/**
 * GlancePulse Main Controller — Even Realities G2 Smart Glasses + Companion Console.
 *
 * Dual-mode architecture:
 *   1. Native EvenHub WebView: drives physical/simulated G2 glasses over
 *      `waitForEvenAppBridge()`, `createStartUpPageContainer`, `rebuildPageContainer`,
 *      `textContainerUpgrade`, `onEvenHubEvent`, and Even localStorage.
 *   2. Browser Companion & Optical Simulator: renders the exact 576x288 G2
 *      micro-LED waveguide layout with full temple/ring gesture emulation and
 *      live Telegram Bot Read+Write configuration.
 */

import {
  waitForEvenAppBridge,
  OsEventTypeList,
} from "@evenrealities/even_hub_sdk";
import {
  FALLBACK_HYPERLIQUID,
  FALLBACK_POLYMARKET,
  DEMO_TELEGRAM_INBOX,
  QUICK_REPLIES,
  fetchHyperliquidPerps,
  fetchPolymarketMarkets,
  fetchTelegramInbox,
  sendTelegramMessage,
  buildPulseSummaryText,
  evaluateAlerts,
} from "./feeds.js";
import {
  G2_WIDTH,
  G2_HEIGHT,
  SCREENS,
  MENU_ACTION_IDS,
  buildG2PagePayload,
  buildDetailUpgrade,
  buildHeaderUpgrade,
} from "./g2-layout.js";
import { renderG2Canvas } from "./simulator.js";

const STORAGE_KEYS = {
  TG_TOKEN: "glancepulse_tg_token",
  TG_CHAT_ID: "glancepulse_tg_chat_id",
  ALERTS: "glancepulse_alerts_v1",
};

const state = {
  screen: "PULSE",
  selectedIndex: 0,
  menuOpen: false,
  menuIndex: 0,
  bridgeMode: "SIMULATOR", // "EVENHUB" | "SIMULATOR"
  bridge: null,
  startedUp: false,
  batteryLevel: 94,
  nowMs: Date.now(),
  hlSource: "DEMO",
  pmSource: "DEMO",
  tgSource: "DEMO",
  perps: [...FALLBACK_HYPERLIQUID],
  markets: [...FALLBACK_POLYMARKET],
  messages: [...DEMO_TELEGRAM_INBOX],
  alerts: [],
  tgToken: "",
  tgChatId: "",
  toast: "",
  toastTimer: null,
  outbox: [],
  wireLog: [],
  lastPayload: null,
};

function logWire(op, summary) {
  const ts = new Date().toTimeString().slice(0, 8);
  state.wireLog.unshift(`[${ts}] ${op} — ${summary}`);
  if (state.wireLog.length > 18) state.wireLog.length = 18;
}

function showToast(msg, durationMs = 3600) {
  state.toast = msg;
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    state.toast = "";
    syncDetailUpgrade().catch(() => {});
    renderCompanion();
  }, durationMs);
  syncDetailUpgrade().catch(() => {});
  renderCompanion();
}

function currentListLength() {
  if (state.screen === "PULSE") return Math.min(3, state.perps.length) + 2;
  if (state.screen === "POLYMARKET") return Math.min(6, state.markets.length);
  if (state.screen === "HYPERLIQUID") return Math.min(6, state.perps.length);
  if (state.screen === "TELEGRAM") return QUICK_REPLIES.length + Math.min(3, state.messages.length);
  return 1;
}

function clampSelection() {
  const max = Math.max(0, currentListLength() - 1);
  state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, max));
}

async function saveConfig() {
  try {
    if (state.bridgeMode === "EVENHUB" && state.bridge) {
      await state.bridge.setLocalStorage(STORAGE_KEYS.TG_TOKEN, state.tgToken);
      await state.bridge.setLocalStorage(STORAGE_KEYS.TG_CHAT_ID, state.tgChatId);
      await state.bridge.setLocalStorage(STORAGE_KEYS.ALERTS, JSON.stringify(state.alerts));
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEYS.TG_TOKEN, state.tgToken);
      localStorage.setItem(STORAGE_KEYS.TG_CHAT_ID, state.tgChatId);
      localStorage.setItem(STORAGE_KEYS.ALERTS, JSON.stringify(state.alerts));
    }
  } catch {
    // Ignore storage unavailability in sandboxed preview contexts.
  }
}

async function loadConfig() {
  try {
    if (state.bridgeMode === "EVENHUB" && state.bridge) {
      state.tgToken = (await state.bridge.getLocalStorage(STORAGE_KEYS.TG_TOKEN)) || "";
      state.tgChatId = (await state.bridge.getLocalStorage(STORAGE_KEYS.TG_CHAT_ID)) || "";
      const rawAlerts = await state.bridge.getLocalStorage(STORAGE_KEYS.ALERTS);
      if (rawAlerts) state.alerts = JSON.parse(rawAlerts);
    } else if (typeof localStorage !== "undefined") {
      state.tgToken = localStorage.getItem(STORAGE_KEYS.TG_TOKEN) || "";
      state.tgChatId = localStorage.getItem(STORAGE_KEYS.TG_CHAT_ID) || "";
      const rawAlerts = localStorage.getItem(STORAGE_KEYS.ALERTS);
      if (rawAlerts) state.alerts = JSON.parse(rawAlerts);
    }
  } catch {
    // Keep defaults if localStorage JSON is empty or malformed.
  }
}

async function syncFullPage() {
  clampSelection();
  state.nowMs = Date.now();
  const isStartup = !state.startedUp;
  const payload = buildG2PagePayload(state, { isStartup });
  state.lastPayload = payload;
  state.startedUp = true;

  const opName = isStartup ? "createStartUpPageContainer" : "rebuildPageContainer";
  logWire(opName, `screen=${state.screen} items=${payload.listObject?.[0]?.itemContainer?.itemCount || 0}`);

  if (state.bridgeMode === "EVENHUB" && state.bridge) {
    try {
      if (isStartup) {
        await state.bridge.createStartUpPageContainer(payload);
      } else {
        await state.bridge.rebuildPageContainer(payload);
      }
    } catch (err) {
      logWire("bridge.err", String(err?.message || err));
    }
  }
  renderCompanion();
}

async function syncDetailUpgrade() {
  state.nowMs = Date.now();
  // Rebuild local cached view so simulator canvas reflects upgraded text immediately.
  state.lastPayload = buildG2PagePayload(state, { isStartup: false });
  const detailUp = buildDetailUpgrade(state);
  const headerUp = buildHeaderUpgrade(state);
  logWire("textContainerUpgrade", `hdr+detail screen=${state.screen} idx=${state.selectedIndex}`);

  if (state.bridgeMode === "EVENHUB" && state.bridge) {
    try {
      await state.bridge.textContainerUpgrade(headerUp);
      await state.bridge.textContainerUpgrade(detailUp);
    } catch (err) {
      logWire("upgrade.err", String(err?.message || err));
    }
  }
  renderCompanion();
}

function switchScreen(nextScreen) {
  if (!SCREENS.includes(nextScreen)) return;
  state.screen = nextScreen;
  state.selectedIndex = 0;
  state.menuOpen = false;
  syncFullPage();
}

function cycleScreen() {
  const idx = SCREENS.indexOf(state.screen);
  const next = SCREENS[(idx + 1) % SCREENS.length];
  switchScreen(next);
}

async function toggleAlertForSelection() {
  if (state.screen === "HYPERLIQUID") {
    const p = state.perps[state.selectedIndex] || state.perps[0];
    if (!p) return;
    const existingIdx = state.alerts.findIndex((a) => a.kind === "perp" && a.target === p.coin);
    if (existingIdx >= 0) {
      state.alerts.splice(existingIdx, 1);
      showToast(`Disarmed ${p.coin} perp alert`);
    } else {
      state.alerts.push({
        kind: "perp",
        target: p.coin,
        anchorPrice: p.markPx,
        thresholdPct: 2.0,
        fundingLimit: 35,
        triggered: false,
      });
      showToast(`Armed ${p.coin} +/-2% & funding alert`);
    }
    await saveConfig();
    await syncFullPage();
    return;
  }

  if (state.screen === "POLYMARKET") {
    const m = state.markets[state.selectedIndex] || state.markets[0];
    if (!m) return;
    const existingIdx = state.alerts.findIndex((a) => a.kind === "polymarket" && a.target === m.id);
    if (existingIdx >= 0) {
      state.alerts.splice(existingIdx, 1);
      showToast(`Disarmed Polymarket alert`);
    } else {
      state.alerts.push({
        kind: "polymarket",
        target: m.id,
        anchorPct: m.yesPct,
        thresholdPct: 5,
        triggered: false,
      });
      showToast(`Armed +/-5% alert on "${m.question.slice(0, 22)}"`);
    }
    await saveConfig();
    await syncFullPage();
    return;
  }

  cycleScreen();
}

async function dispatchTelegram(text) {
  try {
    const receipt = await sendTelegramMessage({
      botToken: state.tgToken,
      chatId: state.tgChatId,
      text,
    });
    state.outbox.unshift({
      time: new Date().toTimeString().slice(0, 8),
      mode: receipt.mode,
      preview: receipt.preview,
    });
    if (state.outbox.length > 10) state.outbox.length = 10;
    logWire("telegram.send", `[${receipt.mode}] ${receipt.preview.slice(0, 42)}`);
    showToast(`Sent [${receipt.mode}]: ${receipt.preview.slice(0, 38)}`);
  } catch (err) {
    logWire("telegram.err", String(err?.message || err));
    showToast(`TG Send Failed: ${String(err?.message || err).slice(0, 42)}`);
  }
}

async function handlePrimaryTap() {
  if (state.menuOpen) {
    const menuItems = state.lastPayload?.menuObject?.menuItems || [];
    const chosen = menuItems[state.menuIndex];
    state.menuOpen = false;
    if (chosen) {
      await handleMenuAction(chosen.itemID);
    }
    return;
  }

  if (state.screen === "TELEGRAM") {
    if (state.selectedIndex < QUICK_REPLIES.length) {
      const q = QUICK_REPLIES[state.selectedIndex];
      const msg = q.text === "__DYNAMIC_PULSE__" ? buildPulseSummaryText(state) : q.text;
      await dispatchTelegram(msg);
    } else {
      state.selectedIndex = 0;
      await syncDetailUpgrade();
    }
    return;
  }

  if (state.screen === "PULSE") {
    if (state.selectedIndex <= 2) switchScreen("HYPERLIQUID");
    else if (state.selectedIndex === 3) switchScreen("POLYMARKET");
    else switchScreen("TELEGRAM");
    return;
  }

  await toggleAlertForSelection();
}

async function handleDoubleTap() {
  if (state.menuOpen) {
    state.menuOpen = false;
    renderCompanion();
    return;
  }
  await dispatchTelegram(buildPulseSummaryText(state));
}

async function handleScroll(delta) {
  if (state.menuOpen) {
    const count = state.lastPayload?.menuObject?.menuItems?.length || 1;
    state.menuIndex = (state.menuIndex + delta + count) % count;
    renderCompanion();
    return;
  }
  const len = currentListLength();
  if (len <= 0) return;
  state.selectedIndex = (state.selectedIndex + delta + len) % len;
  await syncDetailUpgrade();
}

async function handleMenuAction(itemID) {
  switch (itemID) {
    case MENU_ACTION_IDS.SCREEN_PULSE:
      switchScreen("PULSE");
      break;
    case MENU_ACTION_IDS.SCREEN_POLYMARKET:
      switchScreen("POLYMARKET");
      break;
    case MENU_ACTION_IDS.SCREEN_HYPERLIQUID:
      switchScreen("HYPERLIQUID");
      break;
    case MENU_ACTION_IDS.SCREEN_TELEGRAM:
      switchScreen("TELEGRAM");
      break;
    case MENU_ACTION_IDS.ARM_ALERT:
      await toggleAlertForSelection();
      break;
    case MENU_ACTION_IDS.SEND_PULSE_TG:
      await dispatchTelegram(buildPulseSummaryText(state));
      break;
    case MENU_ACTION_IDS.REFRESH_FEEDS:
      await refreshAllFeeds(true);
      break;
    default:
      break;
  }
}

async function refreshAllFeeds(notify = false) {
  const [hl, pm, tg] = await Promise.all([
    fetchHyperliquidPerps(),
    fetchPolymarketMarkets(),
    fetchTelegramInbox({ botToken: state.tgToken, chatId: state.tgChatId }),
  ]);

  state.hlSource = hl.source;
  state.perps = hl.perps;
  state.pmSource = pm.source;
  state.markets = pm.markets;
  state.tgSource = tg.source;
  state.messages = tg.messages;

  // Evaluate armed alerts and auto-broadcast triggered events to Telegram + G2 HUD.
  const fired = evaluateAlerts(state);
  for (const hit of fired) {
    const ref = state.alerts.find((a) => a.kind === hit.kind && a.target === hit.target);
    if (ref) ref.triggered = true;
    await dispatchTelegram(`[GlancePulse ALERT] ${hit.reason}`);
  }

  logWire("feeds.sync", `HL=${hl.source}(${hl.perps.length}) PM=${pm.source}(${pm.markets.length}) TG=${tg.source}`);
  await syncFullPage();
  if (notify) {
    showToast(`Synced HL:${hl.source} PM:${pm.source} TG:${tg.source}`);
  }
}

function handleSdkEvent(event) {
  if (!event) return;
  if (event.menuItemClickEvent?.itemID) {
    handleMenuAction(event.menuItemClickEvent.itemID);
    return;
  }
  if (event.listEvent) {
    const ev = event.listEvent;
    if (typeof ev.currentSelectItemIndex === "number") {
      state.selectedIndex = ev.currentSelectItemIndex;
    }
    if (ev.eventType === OsEventTypeList.CLICK_EVENT) {
      handlePrimaryTap();
    } else if (ev.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      handleDoubleTap();
    } else if (ev.eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      handleScroll(-1);
    } else if (ev.eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      handleScroll(1);
    } else {
      syncDetailUpgrade();
    }
    return;
  }
  if (event.sysEvent) {
    const t = event.sysEvent.eventType;
    if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) handleDoubleTap();
    else if (t === OsEventTypeList.LONG_PRESS_EVENT) cycleScreen();
    else if (t === OsEventTypeList.FOREGROUND_ENTER_EVENT) refreshAllFeeds(false);
  }
}

function renderCompanion() {
  const canvas = document.getElementById("g2-canvas");
  if (canvas) {
    renderG2Canvas(canvas, state.lastPayload, {
      selectedIndex: state.selectedIndex,
      menuOpen: state.menuOpen,
      menuIndex: state.menuIndex,
    });
  }

  const badgeEl = document.getElementById("status-badges");
  if (badgeEl) {
    badgeEl.innerHTML = [
      `<span class="pill ${state.bridgeMode === "EVENHUB" ? "pill-live" : "pill-sim"}">HOST: ${state.bridgeMode}</span>`,
      `<span class="pill ${state.hlSource === "LIVE" ? "pill-live" : "pill-demo"}">HYPERLIQUID: ${state.hlSource}</span>`,
      `<span class="pill ${state.pmSource === "LIVE" ? "pill-live" : "pill-demo"}">POLYMARKET: ${state.pmSource}</span>`,
      `<span class="pill ${state.tgSource === "LIVE" ? "pill-live" : "pill-demo"}">TELEGRAM: ${state.tgSource}</span>`,
    ].join("");
  }

  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === state.screen);
  });

  const outboxEl = document.getElementById("tg-outbox");
  if (outboxEl) {
    outboxEl.innerHTML = state.outbox.length
      ? state.outbox.map((o) => `<li><span class="mono">[${o.time} ${o.mode}]</span> ${escapeHtml(o.preview)}</li>`).join("")
      : `<li class="muted">No Telegram actions dispatched yet. Tap a Quick Reply or double-tap G2.</li>`;
  }

  const wireEl = document.getElementById("wire-log");
  if (wireEl) {
    wireEl.textContent = state.wireLog.join("\n") || "Waiting for EvenHub SDK calls...";
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mountShell() {
  const root = document.getElementById("app");
  if (!root) return;
  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div>
          <h1>GlancePulse <span class="sub">Even Realities G2 HUD</span></h1>
          <p class="tagline">Live Polymarket odds, Hyperliquid perps &amp; 1-tap Telegram Read+Write on 576&times;288 monochrome waveguide optics.</p>
        </div>
        <div id="status-badges" class="badges"></div>
      </header>

      <main class="grid">
        <section class="glasses-panel">
          <div class="frame-header">
            <span class="mono">EVEN G2 WAVEGUIDE &middot; 576&times;288 &middot; 4-BIT GREEN</span>
            <div class="tab-bar">
              ${SCREENS.map((s) => `<button class="tab-btn" data-tab="${s}">${s}</button>`).join("")}
            </div>
          </div>

          <div class="waveguide-bezel">
            <canvas id="g2-canvas" width="${G2_WIDTH}" height="${G2_HEIGHT}"></canvas>
          </div>

          <div class="gesture-deck">
            <button id="btn-up" class="g-btn">Scroll Up (W)</button>
            <button id="btn-down" class="g-btn">Scroll Down (S)</button>
            <button id="btn-tap" class="g-btn g-primary">Temple Tap (Enter)</button>
            <button id="btn-dtap" class="g-btn">2x Tap: Push TG (D)</button>
            <button id="btn-hold" class="g-btn">Long Press: Tab (Tab)</button>
            <button id="btn-menu" class="g-btn">OS Menu (M)</button>
            <button id="btn-sync" class="g-btn">Sync Live APIs (R)</button>
          </div>
        </section>

        <aside class="companion-panel">
          <div class="card">
            <h2>Telegram Bot Read + Write</h2>
            <p class="hint">Leave blank for instant Demo Outbox, or paste your BotFather token &amp; Chat ID (saved locally only, never committed).</p>
            <label class="field">
              <span>Bot Token</span>
              <input id="inp-tg-token" type="password" placeholder="123456:ABC-DEF..." autocomplete="off" />
            </label>
            <label class="field">
              <span>Chat ID</span>
              <input id="inp-tg-chat" type="text" placeholder="e.g. 582910344" autocomplete="off" />
            </label>
            <div class="row-actions">
              <button id="btn-save-tg" class="g-btn g-primary">Save &amp; Sync Telegram</button>
              <button id="btn-test-alert" class="g-btn">Simulate Price Alert</button>
            </div>
          </div>

          <div class="card">
            <h2>Dispatched Telegram Actions</h2>
            <ul id="tg-outbox" class="outbox"></ul>
          </div>

          <div class="card">
            <h2>EvenHub SDK Wire Log</h2>
            <pre id="wire-log" class="wire-log"></pre>
          </div>
        </aside>
      </main>
    </div>
  `;

  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchScreen(btn.dataset.tab));
  });
  document.getElementById("btn-up")?.addEventListener("click", () => handleScroll(-1));
  document.getElementById("btn-down")?.addEventListener("click", () => handleScroll(1));
  document.getElementById("btn-tap")?.addEventListener("click", () => handlePrimaryTap());
  document.getElementById("btn-dtap")?.addEventListener("click", () => handleDoubleTap());
  document.getElementById("btn-hold")?.addEventListener("click", () => cycleScreen());
  document.getElementById("btn-menu")?.addEventListener("click", () => {
    state.menuOpen = !state.menuOpen;
    state.menuIndex = 0;
    renderCompanion();
  });
  document.getElementById("btn-sync")?.addEventListener("click", () => refreshAllFeeds(true));
  document.getElementById("btn-save-tg")?.addEventListener("click", async () => {
    state.tgToken = document.getElementById("inp-tg-token")?.value.trim() || "";
    state.tgChatId = document.getElementById("inp-tg-chat")?.value.trim() || "";
    await saveConfig();
    await refreshAllFeeds(true);
  });
  document.getElementById("btn-test-alert")?.addEventListener("click", async () => {
    const lead = state.perps[0] || FALLBACK_HYPERLIQUID[0];
    await dispatchTelegram(
      `[GlancePulse ALERT] ${lead.coin} crossed threshold at $${lead.markPx} (Funding ${lead.fundingApr}% APR)`
    );
  });

  window.addEventListener("keydown", (e) => {
    if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault();
      handleScroll(-1);
    } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      e.preventDefault();
      handleScroll(1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      handlePrimaryTap();
    } else if (e.key === "d" || e.key === "D") {
      handleDoubleTap();
    } else if (e.key === "Tab") {
      e.preventDefault();
      cycleScreen();
    } else if (e.key === "m" || e.key === "M") {
      state.menuOpen = !state.menuOpen;
      state.menuIndex = 0;
      renderCompanion();
    } else if (e.key === "r" || e.key === "R") {
      refreshAllFeeds(true);
    }
  });
}

async function detectEvenBridge() {
  // Inside Even App Flutter WebView, window.flutter_inappwebview is injected.
  if (typeof window === "undefined" || !window.flutter_inappwebview) {
    state.bridgeMode = "SIMULATOR";
    return null;
  }
  try {
    const bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("bridge timeout")), 2500)),
    ]);
    state.bridge = bridge;
    state.bridgeMode = "EVENHUB";
    bridge.onEvenHubEvent(handleSdkEvent);
    bridge.onDeviceStatusChanged((status) => {
      if (typeof status?.batteryLevel === "number") {
        state.batteryLevel = status.batteryLevel;
        syncDetailUpgrade().catch(() => {});
      }
    });
    const info = await bridge.getDeviceInfo().catch(() => null);
    if (typeof info?.status?.batteryLevel === "number") {
      state.batteryLevel = info.status.batteryLevel;
    }
    return bridge;
  } catch {
    state.bridgeMode = "SIMULATOR";
    return null;
  }
}

async function boot() {
  mountShell();
  await detectEvenBridge();
  await loadConfig();

  const tokenInp = document.getElementById("inp-tg-token");
  const chatInp = document.getElementById("inp-tg-chat");
  if (tokenInp && state.tgToken) tokenInp.value = state.tgToken;
  if (chatInp && state.tgChatId) chatInp.value = state.tgChatId;

  await syncFullPage();
  await refreshAllFeeds(false);

  setInterval(() => {
    refreshAllFeeds(false).catch(() => {});
  }, 30000);
}

boot();
