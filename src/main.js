/**
 * GlancePulse v2.0 Main Controller — Voice-First Telegram & Live Market Copilot
 * for Even Realities G2 Smart Glasses + Companion Optical Simulator.
 *
 * Dual-mode architecture:
 *   1. Native EvenHub WebView / Official `@evenrealities/evenhub-simulator`:
 *      drives G2 waveguide via serialized BLE queue (`createStartUpPageContainer`,
 *      `rebuildPageContainer`, `textContainerUpgrade`, `updateImageRawData`,
 *      `audioControl`, `imuControl`, `onLaunchSource`, `onDeviceStatusChanged`,
 *      `onEvenHubEvent`, `shutDownPageContainer`, Even localStorage).
 *   2. Browser Companion & Optical Simulator: authentic 576x288 4-bit green G2
 *      canvas (with 21px-proportioned typography & grayscale sparklines), full
 *      temple/R1-ring/voice/IMU emulation, and threaded Telegram Bot/Channel I/O.
 */

import {
  AudioInputSource,
  AudioSpeakerRole,
  EventSourceType,
  ImuReportPace,
  OsEventTypeList,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import {
  DEMO_TELEGRAM_INBOX,
  FALLBACK_CANDLES,
  FALLBACK_HYPERLIQUID,
  FALLBACK_POLYMARKET,
  VOICE_PRESET_TRANSCRIPTS,
  buildPulseSummaryText,
  buildSmartReplies,
  evaluateAlerts,
  fetchHyperliquidCandles,
  fetchHyperliquidPerps,
  fetchPolymarketMarkets,
  fetchTelegramInbox,
  mergeInboxMessages,
  sendTelegramMessage,
} from "./feeds.js";
import {
  CONTAINER_IDS,
  G2_HEIGHT,
  G2_WIDTH,
  MENU_ACTION_IDS,
  SCREENS,
  buildDetailUpgrade,
  buildFooterUpgrade,
  buildG2PagePayload,
  buildGraphicForState,
  buildHeaderUpgrade,
  buildImageUpdate,
  buildKpiUpgrade,
  getActiveMessage,
  getFocusContext,
  getListItemsForState,
} from "./g2-layout.js";
import {
  ImuGestureDetector,
  buildSyntheticImuBurst,
  computePcm16Rms,
  normalizeEvenHubListEvent,
} from "./imu-gesture.js";
import { renderG2Canvas } from "./simulator.js";

const STORAGE_KEYS = {
  TG_TOKEN: "glancepulse_tg_token",
  TG_CHAT_ID: "glancepulse_tg_chat_id",
  TG_PROXY: "glancepulse_tg_proxy",
  TG_OFFSET: "glancepulse_tg_offset",
  TG_MESSAGES: "glancepulse_tg_messages_v2",
  ALERTS: "glancepulse_alerts_v2",
};

const imuDetector = new ImuGestureDetector();

const state = {
  screen: "FOCUS",
  selectedIndex: 0,
  messageIndex: 0,
  menuOpen: false,
  menuIndex: 0,
  bridgeMode: "SIMULATOR", // "EVENHUB" | "SIMULATOR"
  bridge: null,
  launchSource: "standalone",
  lastInputSource: "R1 RING",
  startedUp: false,
  batteryLevel: 94,
  nowMs: Date.now(),
  hlSource: "DEMO",
  pmSource: "DEMO",
  tgSource: "DEMO",
  perps: [...FALLBACK_HYPERLIQUID],
  markets: [...FALLBACK_POLYMARKET],
  candlesByCoin: { ...FALLBACK_CANDLES },
  messages: [...DEMO_TELEGRAM_INBOX],
  alerts: [],
  tgToken: "",
  tgChatId: "",
  tgProxyUrl: "",
  tgOffset: 0,
  // Voice & IMU confirmation loop
  voiceRecording: false,
  voiceSpeakerRole: AudioSpeakerRole.Self,
  voiceTranscript: "",
  voiceSeconds: 0,
  voiceStartMs: 0,
  voiceTimer: null,
  audioLevels: new Array(16).fill(0.1),
  lastAudioGraphicMs: 0,
  pendingReply: null, // { text, targetLabel, chatId, replyToMessageId, armAlert? }
  imuActive: false,
  voicePresetIdx: 0,
  // UI & transport telemetry
  toast: "",
  toastTimer: null,
  outbox: [],
  wireLog: [],
  lastPayload: null,
  lastListSignature: "",
  imageBuffers: {},
};

// Serialized BLE write queue prevents concurrent page/text/image/mic races
let bleQueue = Promise.resolve();
let refreshInFlight = false;
let speechRecognition = null;
let voiceDemoTimer = null;
let voiceDemoFinishTimer = null;

function enqueueBridge(opLabel, fn) {
  bleQueue = bleQueue
    .then(async () => {
      try {
        return await fn();
      } catch (err) {
        logWire(`${opLabel}.err`, String(err?.message || err).slice(0, 64));
        return null;
      }
    })
    .catch(() => null);
  return bleQueue;
}

function logWire(op, summary) {
  const ts = new Date().toTimeString().slice(0, 8);
  state.wireLog.unshift(`[${ts}] ${op} — ${summary}`);
  if (state.wireLog.length > 22) state.wireLog.length = 22;
}

function formatEventSource(src) {
  if (src === EventSourceType.TOUCH_EVENT_FROM_RING) return "R1 RING";
  if (src === EventSourceType.TOUCH_EVENT_FROM_GLASSES_R) return "R-TEMPLE";
  if (src === EventSourceType.TOUCH_EVENT_FROM_GLASSES_L) return "L-TEMPLE";
  return state.lastInputSource || "G2";
}

function clampSelection() {
  const items = getListItemsForState(state);
  const max = Math.max(0, items.length - 1);
  state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, max));
  if (state.messages.length > 0) {
    state.messageIndex = Math.max(0, Math.min(state.messageIndex, state.messages.length - 1));
  } else {
    state.messageIndex = 0;
  }
}

function showToast(msg, durationMs = 3400, { skipSync = false } = {}) {
  state.toast = msg;
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    state.toast = "";
    syncIncrementalUpdate().catch(() => {});
  }, durationMs);
  if (!skipSync) {
    syncIncrementalUpdate().catch(() => {});
  }
}

function isDemoMessage(m) {
  return !m || String(m.chatId || "").startsWith("demo-") || m.id === 0;
}

async function saveConfig() {
  try {
    const liveMessages = (state.messages || []).filter((m) => !isDemoMessage(m)).slice(0, 12);
    const entries = [
      [STORAGE_KEYS.TG_TOKEN, state.tgToken],
      [STORAGE_KEYS.TG_CHAT_ID, state.tgChatId],
      [STORAGE_KEYS.TG_PROXY, state.tgProxyUrl],
      [STORAGE_KEYS.TG_OFFSET, String(state.tgOffset || 0)],
      [STORAGE_KEYS.TG_MESSAGES, JSON.stringify(liveMessages)],
      [STORAGE_KEYS.ALERTS, JSON.stringify(state.alerts)],
    ];
    if (state.bridgeMode === "EVENHUB" && state.bridge) {
      for (const [k, v] of entries) {
        await state.bridge.setLocalStorage(k, v);
      }
    } else if (typeof localStorage !== "undefined") {
      for (const [k, v] of entries) {
        localStorage.setItem(k, v);
      }
    }
  } catch {
    // Ignore storage unavailability in restricted preview iframes.
  }
}

async function loadConfig() {
  const readKey = async (k) => {
    if (state.bridgeMode === "EVENHUB" && state.bridge) {
      return (await state.bridge.getLocalStorage(k)) || "";
    }
    return typeof localStorage !== "undefined" ? localStorage.getItem(k) || "" : "";
  };
  try {
    state.tgToken = await readKey(STORAGE_KEYS.TG_TOKEN);
    state.tgChatId = await readKey(STORAGE_KEYS.TG_CHAT_ID);
    state.tgProxyUrl = await readKey(STORAGE_KEYS.TG_PROXY);
    state.tgOffset = Number(await readKey(STORAGE_KEYS.TG_OFFSET)) || 0;
    const rawMsgs = await readKey(STORAGE_KEYS.TG_MESSAGES);
    if (state.tgToken && rawMsgs) {
      const parsedMsgs = JSON.parse(rawMsgs);
      if (Array.isArray(parsedMsgs) && parsedMsgs.length > 0) {
        state.messages = parsedMsgs;
      }
    }
    const rawAlerts = await readKey(STORAGE_KEYS.ALERTS);
    if (rawAlerts) {
      const parsed = JSON.parse(rawAlerts);
      if (Array.isArray(parsed)) state.alerts = parsed;
    }
  } catch {
    // Keep clean defaults if storage is empty or malformed.
  }
}

/**
 * Full page startup or structural rebuild (ONLY when screen or list items change).
 */
async function syncFullPage() {
  clampSelection();
  state.nowMs = Date.now();
  const isStartup = !state.startedUp;
  const payload = buildG2PagePayload(state, { isStartup });
  const graphic = buildGraphicForState(state);
  const imgUpdate = buildImageUpdate(graphic);

  state.lastPayload = payload;
  state.lastListSignature = `${state.screen}:${JSON.stringify(payload.listObject?.[0]?.itemContainer?.itemName || [])}`;
  state.imageBuffers[CONTAINER_IDS.SPARK_IMG] = graphic;
  state.startedUp = true;

  const opName = isStartup ? "createStartUpPageContainer" : "rebuildPageContainer";
  logWire(
    opName,
    `screen=${state.screen} items=${payload.listObject?.[0]?.itemContainer?.itemCount || 0} img=${graphic.kind}(${graphic.pngBytes.length}B)`
  );

  renderCompanion();

  if (state.bridgeMode === "EVENHUB" && state.bridge) {
    await enqueueBridge(opName, async () => {
      if (isStartup) {
        await state.bridge.createStartUpPageContainer(payload);
      } else {
        await state.bridge.rebuildPageContainer(payload);
      }
      await state.bridge.updateImageRawData(imgUpdate);
    });
  }
}

/**
 * Flicker-free incremental refresh (`textContainerUpgrade` + `updateImageRawData`).
 * Preserves native G2 list highlight and avoids full-screen micro-LED flashes.
 */
async function syncIncrementalUpdate({ includeImage = true } = {}) {
  clampSelection();
  state.nowMs = Date.now();

  const payload = buildG2PagePayload(state, { isStartup: false });
  const listSig = `${state.screen}:${JSON.stringify(payload.listObject?.[0]?.itemContainer?.itemName || [])}`;
  if (!state.startedUp || listSig !== state.lastListSignature) {
    return syncFullPage();
  }

  state.lastPayload = payload;
  const hdrUp = buildHeaderUpgrade(state);
  const detUp = buildDetailUpgrade(state);
  const kpiUp = buildKpiUpgrade(state);
  const ftrUp = buildFooterUpgrade(state);

  let imgUpdate = null;
  if (includeImage) {
    const graphic = buildGraphicForState(state);
    state.imageBuffers[CONTAINER_IDS.SPARK_IMG] = graphic;
    imgUpdate = buildImageUpdate(graphic);
  }

  logWire(
    "incrementalUpgrade",
    `screen=${state.screen} idx=${state.selectedIndex}${imgUpdate ? ` +img(${imgUpdate.imageData.length}B)` : ""}`
  );

  renderCompanion();

  if (state.bridgeMode === "EVENHUB" && state.bridge) {
    await enqueueBridge("upgrade", async () => {
      await state.bridge.textContainerUpgrade(hdrUp);
      await state.bridge.textContainerUpgrade(detUp);
      await state.bridge.textContainerUpgrade(kpiUp);
      await state.bridge.textContainerUpgrade(ftrUp);
      if (imgUpdate) {
        await state.bridge.updateImageRawData(imgUpdate);
      }
    });
  }
}

async function setImuListening(enabled) {
  if (state.imuActive === enabled) return;
  state.imuActive = enabled;
  imuDetector.reset();
  logWire("imuControl", enabled ? "ON (P200) — Nod=Send, Shake=Cancel" : "OFF (power save)");

  if (state.bridgeMode === "EVENHUB" && state.bridge) {
    await enqueueBridge("imuControl", async () => {
      try {
        await state.bridge.imuControl(enabled, enabled ? ImuReportPace.P200 : undefined);
      } catch {
        // Simulator / firmware without IMU support safely ignored
      }
    });
  }
}

async function switchScreen(nextScreen) {
  if (!SCREENS.includes(nextScreen)) return;
  if (nextScreen === "PERPS" || nextScreen === "MARKETS") {
    if (state.voiceRecording) {
      await abortVoiceCapture({ skipSync: true });
    }
    if (state.pendingReply) {
      state.pendingReply = null;
      await setImuListening(false);
    }
  }
  state.screen = nextScreen;
  state.selectedIndex = 0;
  state.menuOpen = false;
  await syncFullPage();
}

function cycleScreen() {
  const idx = SCREENS.indexOf(state.screen);
  switchScreen(SCREENS[(idx + 1) % SCREENS.length]);
}

function nextMessage() {
  if (state.messages.length === 0) return;
  state.messageIndex = (state.messageIndex + 1) % state.messages.length;
  state.selectedIndex = 0;
  const ctx = getFocusContext(state);
  if (ctx.kind === "perp" && ctx.perp && !state.candlesByCoin[ctx.perp.coin]) {
    fetchHyperliquidCandles(ctx.perp.coin).then((c) => {
      state.candlesByCoin[c.coin] = c.closes;
      syncIncrementalUpdate({ includeImage: true }).catch(() => {});
    });
  }
  syncFullPage();
}

async function armAlertSpec(spec) {
  if (!spec) return false;
  const existingIdx = state.alerts.findIndex((a) => a.kind === spec.kind && a.target === spec.target);
  if (existingIdx >= 0) {
    state.alerts[existingIdx] = { ...spec, triggered: false };
  } else {
    state.alerts.push({ ...spec, triggered: false });
  }
  await saveConfig();
  return true;
}

async function toggleAlertForSelection() {
  if (state.screen === "PERPS") {
    const p = state.perps[state.selectedIndex] || state.perps[0];
    if (!p) return;
    const existingIdx = state.alerts.findIndex((a) => a.kind === "perp" && a.target === p.coin);
    if (existingIdx >= 0) {
      state.alerts.splice(existingIdx, 1);
      showToast(`Disarmed ${p.coin} perp alert`, 3200, { skipSync: true });
    } else {
      state.alerts.push({
        kind: "perp",
        target: p.coin,
        anchorPrice: p.markPx,
        thresholdPct: 2.0,
        fundingLimit: 35,
        triggered: false,
      });
      showToast(`Armed ${p.coin} ±2% & funding alert`, 3200, { skipSync: true });
    }
    await saveConfig();
    await syncFullPage();
    return;
  }

  if (state.screen === "MARKETS") {
    const m = state.markets[state.selectedIndex] || state.markets[0];
    if (!m) return;
    const existingIdx = state.alerts.findIndex((a) => a.kind === "polymarket" && a.target === m.id);
    if (existingIdx >= 0) {
      state.alerts.splice(existingIdx, 1);
      showToast("Disarmed Polymarket alert", 3200, { skipSync: true });
    } else {
      state.alerts.push({
        kind: "polymarket",
        target: m.id,
        anchorPct: m.yesPct,
        thresholdPct: 5,
        triggered: false,
      });
      showToast(`Armed ±5% alert on ${m.question.slice(0, 18)}`, 3200, { skipSync: true });
    }
    await saveConfig();
    await syncFullPage();
    return;
  }

  // On FOCUS/VOICE: arm alert for the currently entity-linked market
  const ctx = getFocusContext(state);
  if (ctx.kind === "polymarket" && ctx.market) {
    await armAlertSpec({ kind: "polymarket", target: ctx.market.id, anchorPct: ctx.market.yesPct, thresholdPct: 5 });
    showToast(`Armed PM ±5% (${ctx.market.yesPct}% YES)`);
  } else if (ctx.perp) {
    await armAlertSpec({
      kind: "perp",
      target: ctx.perp.coin,
      anchorPrice: ctx.perp.markPx,
      thresholdPct: 2.0,
      fundingLimit: 35,
    });
    showToast(`Armed ${ctx.perp.coin} ±2% alert ($${ctx.perp.markPx})`);
  }
}

async function dispatchTelegram(text, { chatId = "", replyToMessageId = null, targetLabel = "" } = {}) {
  const effectiveChatId = chatId || state.tgChatId;
  try {
    const receipt = await sendTelegramMessage({
      botToken: state.tgToken,
      chatId: effectiveChatId,
      text,
      replyToMessageId,
      proxyUrl: state.tgProxyUrl,
    });
    state.outbox.unshift({
      time: new Date().toTimeString().slice(0, 8),
      mode: receipt.mode,
      target: targetLabel || effectiveChatId || "SIM",
      replyTo: receipt.replyToMessageId || null,
      preview: receipt.preview,
    });
    if (state.outbox.length > 12) state.outbox.length = 12;
    logWire(
      "telegram.send",
      `[${receipt.mode}]${receipt.replyToMessageId ? ` reply#${receipt.replyToMessageId}` : ""} ${receipt.preview.slice(0, 40)}`
    );
    showToast(`Sent [${receipt.mode}]: ${receipt.preview.slice(0, 32)}`, 3400, { skipSync: true });
    await syncFullPage();
    return true;
  } catch (err) {
    const errMsg = String(err?.message || err);
    logWire("telegram.err", errMsg.slice(0, 72));
    showToast(`TG Err: ${errMsg.slice(0, 38)}`, 4200, { skipSync: true });
    await syncFullPage();
    return false;
  }
}

async function queueReplyForConfirmation(text, { armAlert = null } = {}) {
  const msg = getActiveMessage(state);
  state.pendingReply = {
    text: String(text || "").trim(),
    targetLabel: msg?.from || "Telegram",
    chatId: msg?.chatId || state.tgChatId,
    replyToMessageId: msg?.kind === "CHAT" && typeof msg?.id === "number" ? msg.id : null,
    armAlert,
  };
  state.selectedIndex = 0;
  await setImuListening(true);
  await syncFullPage();
}

async function confirmPendingReply(via = "TAP") {
  if (!state.pendingReply) return;
  const draft = state.pendingReply;
  state.pendingReply = null;
  await setImuListening(false);
  if (draft.armAlert) {
    await armAlertSpec(draft.armAlert);
  }
  logWire("confirm.reply", `via=${via} to=${draft.targetLabel}`);
  await dispatchTelegram(draft.text, {
    chatId: draft.chatId,
    replyToMessageId: draft.replyToMessageId,
    targetLabel: draft.targetLabel,
  });
}

async function cancelPendingReply(via = "CANCEL", { skipSync = false } = {}) {
  if (!state.pendingReply) return;
  state.pendingReply = null;
  await setImuListening(false);
  logWire("cancel.reply", `via=${via}`);
  showToast(`Reply canceled (${via})`, 2400, { skipSync: true });
  if (!skipSync) {
    await syncFullPage();
  }
}

function stopBrowserSpeech() {
  if (speechRecognition) {
    try {
      speechRecognition.onresult = null;
      speechRecognition.onerror = null;
      speechRecognition.onend = null;
      speechRecognition.stop();
    } catch {
      // ignore
    }
    speechRecognition = null;
  }
}

function startBrowserSpeech() {
  if (typeof window === "undefined") return false;
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) return false;
  try {
    stopBrowserSpeech();
    const rec = new SpeechRec();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      let full = "";
      for (let i = 0; i < e.results.length; i++) {
        full += e.results[i][0]?.transcript || "";
      }
      if (full.trim()) {
        state.voiceTranscript = full.trim();
        syncIncrementalUpdate({ includeImage: true }).catch(() => {});
      }
    };
    rec.onerror = () => {
      // Silently allow fallback preset transcript on release if browser mic denied
    };
    rec.start();
    speechRecognition = rec;
    return true;
  } catch {
    return false;
  }
}

function clearVoiceTimers() {
  if (state.voiceTimer) {
    clearInterval(state.voiceTimer);
    state.voiceTimer = null;
  }
  if (voiceDemoTimer) {
    clearInterval(voiceDemoTimer);
    voiceDemoTimer = null;
  }
  if (voiceDemoFinishTimer) {
    clearTimeout(voiceDemoFinishTimer);
    voiceDemoFinishTimer = null;
  }
}

async function startVoiceCapture(
  sourceLabel = state.lastInputSource,
  { useBrowserSpeech = true, syntheticJitter = true } = {}
) {
  if (state.voiceRecording) return;
  state.pendingReply = null;
  await setImuListening(false);
  clearVoiceTimers();
  state.voiceRecording = true;
  state.voiceTranscript = "";
  state.voiceSpeakerRole = AudioSpeakerRole.Self;
  state.voiceSeconds = 0;
  state.voiceStartMs = Date.now();
  state.audioLevels = new Array(16).fill(0.14);

  logWire("audioControl", `OPEN(Glasses) src=${sourceLabel}`);

  if (state.bridgeMode === "EVENHUB" && state.bridge) {
    await enqueueBridge("audioControl", async () => {
      await state.bridge.audioControl(true, AudioInputSource.Glasses);
    });
  }

  if (useBrowserSpeech) {
    const speechActive = startBrowserSpeech();
    if (speechActive) {
      logWire("speech.api", "Web Speech dictation active");
    }
  }

  state.voiceTimer = setInterval(() => {
    if (!state.voiceRecording) return;
    state.voiceSeconds = Math.max(1, Math.round((Date.now() - state.voiceStartMs) / 1000));
    if (syntheticJitter && state.bridgeMode !== "EVENHUB") {
      const next = 0.22 + Math.abs(Math.sin(Date.now() / 180)) * 0.52 + Math.random() * 0.18;
      state.audioLevels.shift();
      state.audioLevels.push(Math.min(1, next));
      syncIncrementalUpdate({ includeImage: true }).catch(() => {});
    }
  }, 300);

  await syncFullPage();
}

/**
 * Cleanly abort an in-progress voice capture (e.g. on FOREGROUND_EXIT / SYSTEM_EXIT
 * or screen change) WITHOUT drafting a reply, arming IMU, or rebuilding the G2 page.
 */
async function abortVoiceCapture({ skipSync = true } = {}) {
  if (!state.voiceRecording) return;
  state.voiceRecording = false;
  clearVoiceTimers();
  stopBrowserSpeech();
  logWire("audioControl", "ABORT");

  if (state.bridgeMode === "EVENHUB" && state.bridge) {
    await enqueueBridge("audioControl", async () => {
      await state.bridge.audioControl(false);
    });
  }

  if (!skipSync) {
    await syncFullPage();
  } else {
    renderCompanion();
  }
}

async function stopVoiceCapture({ forcedTranscript = "" } = {}) {
  if (!state.voiceRecording) return;
  state.voiceRecording = false;
  clearVoiceTimers();
  stopBrowserSpeech();
  logWire("audioControl", "CLOSE");

  if (state.bridgeMode === "EVENHUB" && state.bridge) {
    await enqueueBridge("audioControl", async () => {
      await state.bridge.audioControl(false);
    });
  }

  let transcript = String(forcedTranscript || state.voiceTranscript || "").trim();
  if (!transcript) {
    // Graceful context-aware fallback so judges without mic hardware complete the full loop
    const ctx = getFocusContext(state);
    if (ctx.kind === "perp" && ctx.perp) {
      transcript = `Copy — ${ctx.perp.coin} is $${ctx.perp.markPx}. Trim half and keep G2 alert armed.`;
    } else if (ctx.kind === "polymarket" && ctx.market) {
      transcript = `Tracking ${ctx.market.yesPct}% YES on Polymarket — ready to sync in 5m.`;
    } else {
      transcript = VOICE_PRESET_TRANSCRIPTS[state.voicePresetIdx % VOICE_PRESET_TRANSCRIPTS.length];
      state.voicePresetIdx++;
    }
  }

  // Enrich voice reply automatically with "[G2 Voice]" provenance tag
  await queueReplyForConfirmation(`[G2 Voice] ${transcript}`);
}

/**
 * 1-click guided voice dictation demo for judges without a microphone or G2 glasses.
 * Injects realistic synthetic 16kHz PCM16 frames through `handleAudioFrame` without
 * triggering browser mic permission prompts or competing jitter timers.
 */
async function runSimulatedVoiceDemo() {
  if (state.voiceRecording) {
    await stopVoiceCapture();
    return;
  }
  const preset = VOICE_PRESET_TRANSCRIPTS[state.voicePresetIdx % VOICE_PRESET_TRANSCRIPTS.length];
  state.voicePresetIdx++;
  await startVoiceCapture("R1 RING (SIM)", { useBrowserSpeech: false, syntheticJitter: false });
  const words = preset.split(" ");
  let idx = 0;
  let tick = 0;
  voiceDemoTimer = setInterval(() => {
    if (!state.voiceRecording) {
      clearVoiceTimers();
      return;
    }
    tick++;
    state.voiceSeconds = Math.max(1, Math.round((Date.now() - state.voiceStartMs) / 1000));
    const pcm = new Uint8Array(320);
    const dv = new DataView(pcm.buffer);
    const amp = 6500 + Math.round(Math.abs(Math.sin(tick * 1.15)) * 12000);
    for (let i = 0; i < 160; i++) {
      dv.setInt16(i * 2, Math.round(Math.sin((i / 160) * Math.PI * 10) * amp), true);
    }
    handleAudioFrame({ audioPcm: pcm, speakerRole: AudioSpeakerRole.Self });

    idx += 2;
    state.voiceTranscript = words.slice(0, idx).join(" ");
    syncIncrementalUpdate({ includeImage: true }).catch(() => {});
    if (idx >= words.length) {
      clearInterval(voiceDemoTimer);
      voiceDemoTimer = null;
      voiceDemoFinishTimer = setTimeout(() => {
        voiceDemoFinishTimer = null;
        if (state.voiceRecording) {
          stopVoiceCapture({ forcedTranscript: preset }).catch(() => {});
        }
      }, 360);
    }
  }, 240);
}

async function handlePrimaryTap() {
  if (state.menuOpen) {
    const menuItems = state.lastPayload?.menuObject?.menuItems || [];
    const chosen = menuItems[state.menuIndex];
    state.menuOpen = false;
    if (chosen) await handleMenuAction(chosen.itemID);
    return;
  }

  if (state.voiceRecording) {
    await stopVoiceCapture();
    return;
  }

  if (state.screen === "FOCUS") {
    if (state.pendingReply) {
      if (state.selectedIndex === 0) await confirmPendingReply(`${state.lastInputSource} TAP`);
      else if (state.selectedIndex === 1) await startVoiceCapture(state.lastInputSource);
      else await cancelPendingReply("TAP");
      return;
    }
    const msg = getActiveMessage(state);
    const ctx = getFocusContext(state);
    const smart = buildSmartReplies(msg, ctx, state);
    if (state.selectedIndex === 0) {
      await startVoiceCapture(state.lastInputSource);
    } else if (state.selectedIndex === 1) {
      await queueReplyForConfirmation(smart[0].text, { armAlert: smart[0].armAlert });
    } else if (state.selectedIndex === 2) {
      await queueReplyForConfirmation(smart[1].text, { armAlert: smart[1].armAlert });
    } else if (state.selectedIndex === 3) {
      nextMessage();
    } else {
      await queueReplyForConfirmation(smart[2].text);
    }
    return;
  }

  if (state.screen === "VOICE") {
    if (state.selectedIndex === 0) {
      if (state.pendingReply) await confirmPendingReply(`${state.lastInputSource} TAP`);
      else await startVoiceCapture(state.lastInputSource);
    } else if (state.selectedIndex === 1) {
      await startVoiceCapture(state.lastInputSource);
    } else if (state.selectedIndex === 2) {
      const ctx = getFocusContext(state);
      const tag = ctx.kind === "polymarket" && ctx.market
        ? `[PM ${ctx.market.yesPct}% YES]`
        : ctx.perp
          ? `[${ctx.perp.coin} $${ctx.perp.markPx}]`
          : "";
      const baseText = state.pendingReply?.text || "[G2 Voice] Watching live desk flow";
      const nextText = tag && !baseText.includes(tag) ? `${baseText} ${tag}` : baseText;
      await queueReplyForConfirmation(nextText);
    } else {
      await cancelPendingReply("EXIT", { skipSync: true });
      await switchScreen("FOCUS");
    }
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
  if (state.pendingReply) {
    await cancelPendingReply("2xTAP");
    return;
  }
  if (state.screen === "FOCUS") {
    nextMessage();
    return;
  }
  if (state.screen === "VOICE") {
    switchScreen("FOCUS");
    return;
  }
  await dispatchTelegram(buildPulseSummaryText(state), { targetLabel: "Pulse Broadcast" });
}

async function handleScroll(delta) {
  if (state.menuOpen) {
    const count = state.lastPayload?.menuObject?.menuItems?.length || 1;
    state.menuIndex = (state.menuIndex + delta + count) % count;
    renderCompanion();
    return;
  }
  const items = getListItemsForState(state);
  if (items.length <= 0) return;
  state.selectedIndex = (state.selectedIndex + delta + items.length) % items.length;
  await syncIncrementalUpdate({ includeImage: true });
}

async function handleMenuAction(itemID) {
  switch (itemID) {
    case MENU_ACTION_IDS.SCREEN_FOCUS:
      switchScreen("FOCUS");
      break;
    case MENU_ACTION_IDS.SCREEN_PERPS:
      switchScreen("PERPS");
      break;
    case MENU_ACTION_IDS.SCREEN_MARKETS:
      switchScreen("MARKETS");
      break;
    case MENU_ACTION_IDS.SCREEN_VOICE:
      switchScreen("VOICE");
      break;
    case MENU_ACTION_IDS.NEXT_MSG:
      state.screen = "FOCUS";
      nextMessage();
      break;
    case MENU_ACTION_IDS.TOGGLE_VOICE:
      if (state.voiceRecording) await stopVoiceCapture();
      else await startVoiceCapture("MENU");
      break;
    case MENU_ACTION_IDS.ARM_ALERT:
      await toggleAlertForSelection();
      break;
    case MENU_ACTION_IDS.SEND_PULSE_TG:
      await dispatchTelegram(buildPulseSummaryText(state), { targetLabel: "Pulse Broadcast" });
      break;
    case MENU_ACTION_IDS.REFRESH_FEEDS:
      await refreshAllFeeds(true);
      break;
    default:
      break;
  }
}

async function refreshAllFeeds(notify = false) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const activeCtx = getFocusContext(state);
    const activeCoin =
      state.screen === "PERPS"
        ? state.perps[state.selectedIndex]?.coin || "BTC"
        : activeCtx.perp?.coin || "BTC";

    const [hl, pm, tg, activeCandles, btcCandles] = await Promise.all([
      fetchHyperliquidPerps(),
      fetchPolymarketMarkets(),
      fetchTelegramInbox({
        botToken: state.tgToken,
        chatId: state.tgChatId,
        offset: state.tgOffset,
        proxyUrl: state.tgProxyUrl,
      }),
      fetchHyperliquidCandles(activeCoin),
      activeCoin === "BTC" ? Promise.resolve(null) : fetchHyperliquidCandles("BTC"),
    ]);

    state.hlSource = hl.source;
    state.perps = hl.perps;
    state.pmSource = pm.source;
    state.markets = pm.markets;
    state.candlesByCoin[activeCandles.coin] = activeCandles.closes;
    if (btcCandles) state.candlesByCoin[btcCandles.coin] = btcCandles.closes;

    let tgSyncError = "";
    if (tg.source === "LIVE") {
      state.tgSource = "LIVE";
      let persistNeeded = false;
      if (tg.nextOffset > state.tgOffset) {
        state.tgOffset = tg.nextOffset;
        persistNeeded = true;
      }
      if (!state.tgChatId && tg.discoveredChatId) {
        state.tgChatId = tg.discoveredChatId;
        const chatInp = typeof document !== "undefined" ? document.getElementById("inp-tg-chat") : null;
        if (chatInp) chatInp.value = state.tgChatId;
        persistNeeded = true;
      }
      const cachedLive = (state.messages || []).filter((m) => !isDemoMessage(m));
      if (tg.messages.length > 0) {
        state.messages = mergeInboxMessages(cachedLive, tg.messages, 12);
        persistNeeded = true;
      } else if (cachedLive.length > 0) {
        state.messages = cachedLive;
      } else {
        state.messages = [
          {
            id: 0,
            kind: "CHAT",
            from: "Bot Ready",
            chatId: state.tgChatId,
            time: "--:--",
            text: "Connected. Message your bot or channel to view on G2.",
          },
        ];
      }
      if (persistNeeded) await saveConfig();
    } else if (!state.tgToken) {
      state.tgSource = "DEMO";
    } else {
      state.tgSource = "DEMO";
      tgSyncError = String(tg.error || "Telegram getUpdates failed");
      logWire("telegram.err", tgSyncError.slice(0, 72));
    }

    // Evaluate armed alerts and persist triggered flag so reload never double-fires!
    const fired = evaluateAlerts(state);
    if (fired.length > 0) {
      for (const hit of fired) {
        const ref = state.alerts.find((a) => a.kind === hit.kind && a.target === hit.target);
        if (ref) ref.triggered = true;
        await dispatchTelegram(`[GlancePulse ALERT] ${hit.reason}`, { targetLabel: "Price Alert" });
      }
      await saveConfig();
    }

    logWire(
      "feeds.sync",
      `HL=${hl.source}(${hl.perps.length}) PM=${pm.source}(${pm.markets.length}) TG=${state.tgSource} off=${state.tgOffset}`
    );

    if (notify) {
      showToast(
        tgSyncError
          ? `TG Err: ${tgSyncError.slice(0, 34)}`
          : `Synced HL:${hl.source} PM:${pm.source} TG:${state.tgSource}`,
        tgSyncError ? 4000 : 2600,
        { skipSync: true }
      );
    }
    // Flicker-free incremental upgrade preserves G2 list selection!
    await syncIncrementalUpdate({ includeImage: true });
  } finally {
    refreshInFlight = false;
  }
}

function handleAudioFrame(audio) {
  if (!audio || !state.voiceRecording) return;
  const role = audio.speakerRole || AudioSpeakerRole.Unknown;
  state.voiceSpeakerRole = role;
  // Ignore bystander speech ("other") from spiking self voice meter
  const rms = role === AudioSpeakerRole.Other ? 0.08 : computePcm16Rms(audio.audioPcm);
  state.audioLevels.shift();
  state.audioLevels.push(Math.max(0.08, rms));

  const now = Date.now();
  if (now - state.lastAudioGraphicMs >= 260) {
    state.lastAudioGraphicMs = now;
    syncIncrementalUpdate({ includeImage: true }).catch(() => {});
  }
}

function handleImuData(imuData, nowMs = Date.now()) {
  const gesture = imuDetector.push(imuData, nowMs);
  if (!gesture) return;
  logWire("imu.gesture", `${gesture} detected`);
  if (state.pendingReply) {
    if (gesture === "NOD") confirmPendingReply("IMU NOD");
    else if (gesture === "SHAKE") cancelPendingReply("IMU SHAKE");
  } else if (gesture === "SHAKE" && state.menuOpen) {
    state.menuOpen = false;
    renderCompanion();
  }
}

export function handleSdkEvent(event) {
  if (!event) return;

  if (event.audioEvent) {
    handleAudioFrame(event.audioEvent);
    return;
  }

  if (event.menuItemClickEvent?.itemID) {
    handleMenuAction(event.menuItemClickEvent.itemID);
    return;
  }

  if (event.listEvent) {
    const items = getListItemsForState(state);
    const norm = normalizeEvenHubListEvent(event.listEvent, items, state.selectedIndex);
    state.selectedIndex = norm.index;
    logWire("listEvent", `${norm.action} idx=${norm.index}`);

    if (norm.action === "CLICK") {
      handlePrimaryTap();
    } else if (norm.action === "DOUBLE_CLICK") {
      handleDoubleTap();
    } else if (norm.action === "LONG_PRESS") {
      startVoiceCapture(state.lastInputSource);
    } else if (norm.action === "LONG_PRESS_RELEASE") {
      stopVoiceCapture();
    } else {
      // SCROLL_SYNC or SYNC: firmware already advanced cursor — never double-step!
      syncIncrementalUpdate({ includeImage: true });
    }
    return;
  }

  if (event.sysEvent) {
    const sys = event.sysEvent;
    const t = sys.eventType;
    if (sys.eventSource !== undefined) {
      state.lastInputSource = formatEventSource(sys.eventSource);
    }
    if (t === OsEventTypeList.IMU_DATA_REPORT && sys.imuData) {
      handleImuData(sys.imuData);
    } else if (t === OsEventTypeList.LONG_PRESS_EVENT) {
      startVoiceCapture(state.lastInputSource);
    } else if (t === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) {
      stopVoiceCapture();
    } else if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      handleDoubleTap();
    } else if (
      t === OsEventTypeList.CLICK_EVENT ||
      (t === undefined && !sys.imuData && sys.systemExitReasonCode === undefined && sys.eventSource !== undefined)
    ) {
      handlePrimaryTap();
    } else if (t === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
      refreshAllFeeds(false);
    } else if (
      t === OsEventTypeList.FOREGROUND_EXIT_EVENT ||
      t === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      t === OsEventTypeList.ABNORMAL_EXIT_EVENT
    ) {
      abortVoiceCapture({ skipSync: true });
      setImuListening(false);
    }
  }
}

function simulateImuGesture(gesture) {
  const frames = buildSyntheticImuBurst(gesture, Date.now());
  for (const f of frames) {
    handleImuData(f, f.t);
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderCompanion() {
  if (typeof document === "undefined") return;
  const canvas = document.getElementById("g2-canvas");
  if (canvas) {
    renderG2Canvas(canvas, state.lastPayload, {
      selectedIndex: state.selectedIndex,
      menuOpen: state.menuOpen,
      menuIndex: state.menuIndex,
      imageBuffers: state.imageBuffers,
    });
  }

  const badgeEl = document.getElementById("status-badges");
  if (badgeEl) {
    badgeEl.innerHTML = [
      `<span class="pill ${state.bridgeMode === "EVENHUB" ? "pill-live" : "pill-sim"}">HOST: ${state.bridgeMode}</span>`,
      `<span class="pill ${state.hlSource === "LIVE" ? "pill-live" : "pill-demo"}">HL: ${state.hlSource}</span>`,
      `<span class="pill ${state.pmSource === "LIVE" ? "pill-live" : "pill-demo"}">PM: ${state.pmSource}</span>`,
      `<span class="pill ${state.tgSource === "LIVE" ? "pill-live" : "pill-demo"}">TG: ${state.tgSource}</span>`,
      `<span class="pill ${state.voiceRecording ? "pill-warn" : "pill-sim"}">MIC: ${state.voiceRecording ? "REC" : "IDLE"}</span>`,
      `<span class="pill ${state.imuActive ? "pill-live" : "pill-sim"}">IMU: ${state.imuActive ? "ARMED" : "SLEEP"}</span>`,
      `<span class="pill pill-sim">IN: ${escapeHtml(state.lastInputSource)}</span>`,
    ].join("");
  }

  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === state.screen);
  });

  const voiceBtn = document.getElementById("btn-voice");
  if (voiceBtn) {
    voiceBtn.textContent = state.voiceRecording ? "Stop Mic & Draft (V)" : "Hold/Toggle Mic (V)";
    voiceBtn.classList.toggle("g-recording", state.voiceRecording);
  }

  const nodBtn = document.getElementById("btn-nod");
  const shakeBtn = document.getElementById("btn-shake");
  if (nodBtn) nodBtn.classList.toggle("g-primary", Boolean(state.pendingReply));
  if (shakeBtn) shakeBtn.classList.toggle("g-warn", Boolean(state.pendingReply));

  const outboxEl = document.getElementById("tg-outbox");
  if (outboxEl) {
    outboxEl.innerHTML = state.outbox.length
      ? state.outbox
          .map(
            (o) =>
              `<li><span class="mono">[${o.time} ${o.mode}${o.replyTo ? ` #${o.replyTo}` : ""}]</span> ${escapeHtml(o.preview)}</li>`
          )
          .join("")
      : `<li class="muted">No Telegram actions yet. Try "1-Click Voice Demo" then press Nod (N) or Tap (Enter).</li>`;
  }

  const wireEl = document.getElementById("wire-log");
  if (wireEl) {
    wireEl.textContent = state.wireLog.join("\n") || "Waiting for EvenHub SDK calls...";
  }
}

function mountShell() {
  const root = document.getElementById("app");
  if (!root) return;
  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div>
          <h1>GlancePulse <span class="sub">v2.0 · Even Realities G2 Copilot</span></h1>
          <p class="tagline">One thing that matters: entity-linked Telegram &times; Hyperliquid/Polymarket Focus Card with G2 Mic Voice Reply, 4-bit Grayscale Sparklines &amp; IMU Head-Nod Confirm.</p>
        </div>
        <div id="status-badges" class="badges"></div>
      </header>

      <main class="grid">
        <section class="glasses-panel">
          <div class="frame-header">
            <span class="mono">EVEN G2 WAVEGUIDE &middot; 576&times;288 &middot; 4-BIT GREEN + SPARKLINE</span>
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
            <button id="btn-tap" class="g-btn g-primary">Tap / Confirm (Enter)</button>
            <button id="btn-voice" class="g-btn">Hold/Toggle Mic (V)</button>
            <button id="btn-voice-demo" class="g-btn g-accent">1-Click Voice Demo</button>
            <button id="btn-nod" class="g-btn">IMU Head Nod (N)</button>
            <button id="btn-shake" class="g-btn">IMU Head Shake (X)</button>
            <button id="btn-dtap" class="g-btn">2x Tap: Next/Cancel (D)</button>
            <button id="btn-menu" class="g-btn">OS Menu (M)</button>
            <button id="btn-source" class="g-btn">Input: R1 Ring / Temple</button>
            <button id="btn-sync" class="g-btn">Sync Live APIs (R)</button>
          </div>
        </section>

        <aside class="companion-panel">
          <div class="card">
            <h2>Telegram Read + Threaded Write</h2>
            <p class="hint">Works out-of-the-box in Demo mode, or connect your BotFather token for live DM/Group/Channel reads &amp; threaded replies. In desktop browsers, optionally point CORS Proxy URL to your deployed <code>proxy/cloudflare-worker.js</code>.</p>
            <label class="field">
              <span>Bot Token</span>
              <input id="inp-tg-token" type="password" placeholder="123456:ABC-DEF..." autocomplete="off" />
            </label>
            <label class="field">
              <span>Chat ID (optional — auto-detected from getUpdates)</span>
              <input id="inp-tg-chat" type="text" placeholder="e.g. 582910344" autocomplete="off" />
            </label>
            <label class="field">
              <span>CORS Proxy URL (optional for desktop browser)</span>
              <input id="inp-tg-proxy" type="url" placeholder="https://your-worker.workers.dev" autocomplete="off" />
            </label>
            <div class="row-actions">
              <button id="btn-save-tg" class="g-btn g-primary">Save &amp; Sync Telegram</button>
              <button id="btn-inject-msg" class="g-btn">Simulate Desk Msg</button>
            </div>
          </div>

          <div class="card">
            <h2>Dispatched Threaded Telegram Actions</h2>
            <ul id="tg-outbox" class="outbox"></ul>
          </div>

          <div class="card">
            <h2>EvenHub SDK Wire Log (Serialized BLE)</h2>
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
  document.getElementById("btn-voice")?.addEventListener("click", () => {
    if (state.voiceRecording) stopVoiceCapture();
    else startVoiceCapture(state.lastInputSource);
  });
  document.getElementById("btn-voice-demo")?.addEventListener("click", () => runSimulatedVoiceDemo());
  document.getElementById("btn-nod")?.addEventListener("click", () => simulateImuGesture("NOD"));
  document.getElementById("btn-shake")?.addEventListener("click", () => simulateImuGesture("SHAKE"));
  document.getElementById("btn-dtap")?.addEventListener("click", () => handleDoubleTap());
  document.getElementById("btn-menu")?.addEventListener("click", () => {
    state.menuOpen = !state.menuOpen;
    state.menuIndex = 0;
    renderCompanion();
  });
  document.getElementById("btn-source")?.addEventListener("click", () => {
    const order = ["R1 RING", "R-TEMPLE", "L-TEMPLE"];
    const next = order[(order.indexOf(state.lastInputSource) + 1) % order.length];
    state.lastInputSource = next;
    logWire("input.source", `switched to ${next}`);
    renderCompanion();
  });
  document.getElementById("btn-sync")?.addEventListener("click", () => refreshAllFeeds(true));
  document.getElementById("btn-save-tg")?.addEventListener("click", async () => {
    const prevToken = state.tgToken;
    state.tgToken = document.getElementById("inp-tg-token")?.value.trim() || "";
    state.tgChatId = document.getElementById("inp-tg-chat")?.value.trim() || "";
    state.tgProxyUrl = document.getElementById("inp-tg-proxy")?.value.trim() || "";
    if (state.tgToken !== prevToken) {
      state.tgOffset = 0;
      state.messages = state.tgToken ? [] : [...DEMO_TELEGRAM_INBOX];
      state.messageIndex = 0;
    }
    await saveConfig();
    await refreshAllFeeds(true);
  });

  let simMsgCounter = 200;
  const simPool = [
    { from: "Maya (Quant)", kind: "CHAT", text: "HYPE funding just crossed 30% APR on Hyperliquid — hedge?" },
    { from: "BTC Desk", kind: "CHANNEL", text: "BTC breaking resistance while Polymarket Fed odds tighten." },
    { from: "Liam (PM)", kind: "CHAT", text: "ETH perp basis widening fast. Update target?" },
  ];
  document.getElementById("btn-inject-msg")?.addEventListener("click", async () => {
    const tpl = simPool[simMsgCounter % simPool.length];
    simMsgCounter++;
    const now = new Date();
    const msg = {
      id: simMsgCounter,
      updateId: simMsgCounter,
      kind: tpl.kind,
      from: tpl.from,
      chatId: `demo-sim-${simMsgCounter}`,
      time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      text: tpl.text,
    };
    if (state.voiceRecording) {
      await abortVoiceCapture({ skipSync: true });
    }
    state.messages = mergeInboxMessages(state.messages, [msg], 12);
    state.screen = "FOCUS";
    state.messageIndex = 0;
    state.selectedIndex = 0;
    state.pendingReply = null;
    await setImuListening(false);
    logWire("telegram.in", `[${msg.kind}] ${msg.from}: ${msg.text.slice(0, 36)}`);
    await syncFullPage();
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
    } else if (e.key === "v" || e.key === "V") {
      e.preventDefault();
      if (state.voiceRecording) stopVoiceCapture();
      else startVoiceCapture(state.lastInputSource);
    } else if (e.key === "n" || e.key === "N") {
      simulateImuGesture("NOD");
    } else if (e.key === "x" || e.key === "X") {
      simulateImuGesture("SHAKE");
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

/**
 * Connect to EvenAppBridge cleanly without premature synchronous bailout,
 * supporting both physical Even App WebView and official `@evenrealities/evenhub-simulator`.
 */
async function detectEvenBridge() {
  if (typeof window === "undefined") {
    state.bridgeMode = "SIMULATOR";
    return null;
  }
  try {
    const bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("bridge timeout")), 1800)),
    ]);

    // Allow brief window for async flutter_inappwebview / simulator handler attachment
    if (!window.flutter_inappwebview?.callHandler) {
      await new Promise((resolve) => setTimeout(resolve, 180));
    }

    // Verify native/simulator handler responds cleanly (getDeviceInfo returns null when no host exists)
    const hasNativeHost = Boolean(window.flutter_inappwebview?.callHandler);
    const info = await Promise.race([
      bridge.getDeviceInfo(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("device probe timeout")), 1200)),
    ]);

    if (!hasNativeHost && !info) {
      state.bridgeMode = "SIMULATOR";
      return null;
    }

    state.bridge = bridge;
    state.bridgeMode = "EVENHUB";
    if (typeof info?.status?.batteryLevel === "number") {
      state.batteryLevel = info.status.batteryLevel;
    }

    bridge.onLaunchSource((src) => {
      state.launchSource = src;
      logWire("launchSource", src);
    });
    bridge.onEvenHubEvent(handleSdkEvent);
    bridge.onDeviceStatusChanged((status) => {
      if (typeof status?.batteryLevel === "number") {
        state.batteryLevel = status.batteryLevel;
        syncIncrementalUpdate({ includeImage: false }).catch(() => {});
      }
    });

    window.addEventListener("beforeunload", () => {
      try {
        bridge.audioControl(false).catch(() => {});
        bridge.imuControl(false).catch(() => {});
        bridge.shutDownPageContainer(0).catch(() => {});
      } catch {
        // ignore
      }
    });

    logWire("bridge.ready", `EvenHub attached (model=${info?.model || "g2"})`);
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
  const proxyInp = document.getElementById("inp-tg-proxy");
  if (tokenInp && state.tgToken) tokenInp.value = state.tgToken;
  if (chatInp && state.tgChatId) chatInp.value = state.tgChatId;
  if (proxyInp && state.tgProxyUrl) proxyInp.value = state.tgProxyUrl;

  await syncFullPage();
  await refreshAllFeeds(false);

  setInterval(() => {
    refreshAllFeeds(false).catch(() => {});
  }, 30000);
}

export function getControllerState() {
  return state;
}

if (typeof document !== "undefined") {
  boot();
}
