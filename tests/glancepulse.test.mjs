import test from "node:test";
import assert from "node:assert/strict";
import {
  EventSourceType,
  OsEventTypeList,
  validateEvenHubPageContainer,
} from "@evenrealities/even_hub_sdk";
import {
  DEMO_TELEGRAM_INBOX,
  FALLBACK_CANDLES,
  FALLBACK_HYPERLIQUID,
  FALLBACK_POLYMARKET,
  HYPERLIQUID_ENDPOINTS,
  PRESET_WALLETS,
  buildPulseSummaryText,
  buildSmartReplies,
  encodeTelegramBotToken,
  evaluateAlerts,
  extractMarketContext,
  fetchHyperliquidCandles,
  fetchHyperliquidWallet,
  fetchTelegramInbox,
  isValidEvmAddress,
  mergeInboxMessages,
  parseClearinghouseState,
  parseHyperliquidResponse,
  parsePolymarketResponse,
  resolveHyperliquidUrl,
  resolveTelegramBaseUrl,
  sendTelegramMessage,
} from "../src/feeds.js";
import {
  CONTAINER_IDS,
  G2_HEIGHT,
  G2_TEXT_LIMITS,
  G2_WIDTH,
  SCREENS,
  buildDetailTextForScreen,
  buildDetailUpgrade,
  buildFooterUpgrade,
  buildG2PagePayload,
  buildGraphicForState,
  buildHeaderUpgrade,
  buildImageUpdate,
  buildKpiUpgrade,
  buildWalletListEntries,
  deriveToastHeading,
} from "../src/g2-layout.js";
import { parseTelegramProxyPath } from "../proxy/cloudflare-worker.js";
import { getControllerState, handleSdkEvent, submitVoiceCommandText } from "../src/main.js";
import {
  SPARK_IMG_HEIGHT,
  SPARK_IMG_WIDTH,
  renderMicWaveformImage,
  renderProbabilityBarImage,
  renderSparklineImage,
} from "../src/graphics.js";
import {
  ImuGestureDetector,
  buildSyntheticImuBurst,
  computePcm16Rms,
  normalizeEvenHubListEvent,
} from "../src/imu-gesture.js";
import {
  closePaperPosition,
  computePaperPortfolioMetrics,
  createDefaultPaperBook,
  executePaperIntent,
  parseVoiceTradeIntent,
} from "../src/trading.js";

function makeBaseState(overrides = {}) {
  return {
    screen: "FOCUS",
    selectedIndex: 0,
    messageIndex: 0,
    nowMs: 1795320000000,
    hlSource: "LIVE",
    pmSource: "LIVE",
    tgSource: "LIVE",
    batteryLevel: 91,
    perps: FALLBACK_HYPERLIQUID,
    markets: FALLBACK_POLYMARKET,
    candlesByCoin: FALLBACK_CANDLES,
    messages: DEMO_TELEGRAM_INBOX,
    alerts: [{ kind: "perp", target: "BTC", anchorPrice: 95000, thresholdPct: 2, fundingLimit: 30, triggered: false }],
    voiceRecording: false,
    voiceSpeakerRole: "self",
    voiceTranscript: "",
    voiceSeconds: 0,
    audioLevels: new Array(16).fill(0.35),
    pendingReply: null,
    imuActive: false,
    toast: "",
    ...overrides,
  };
}

function boxesOverlap(a, b) {
  return (
    a.xPosition < b.xPosition + b.width &&
    a.xPosition + a.width > b.xPosition &&
    a.yPosition < b.yPosition + b.height &&
    a.yPosition + a.height > b.yPosition
  );
}

test("1. All 5 G2 screens + voice/confirm states produce protocol-valid, non-overlapping 6-container pages", () => {
  const scenarios = [
    ...SCREENS.map((screen) => makeBaseState({ screen })),
    makeBaseState({ screen: "FOCUS", voiceRecording: true, voiceTranscript: "Trim half SOL perp now and arm alert" }),
    makeBaseState({
      screen: "FOCUS",
      imuActive: true,
      pendingReply: { text: "[G2 Voice] Trim half SOL now", targetLabel: "Alex (Desk)" },
    }),
    makeBaseState({ screen: "FOCUS", messageIndex: 1 }), // Polymarket-linked message
    makeBaseState({ screen: "FOCUS", toast: "Sent [LIVE]: [G2 Voice] Trim half SOL now" }),
  ];

  for (const st of scenarios) {
    const startup = buildG2PagePayload(st, { isStartup: true });
    const rebuild = buildG2PagePayload(st, { isStartup: false });

    assert.equal(validateEvenHubPageContainer(startup).valid, true);
    assert.equal(validateEvenHubPageContainer(rebuild).valid, true);
    assert.equal(startup.containerTotalNum, 6);
    assert.equal(startup.textObject.length, 4);
    assert.equal(startup.listObject.length, 1);
    assert.equal(startup.imageObject.length, 1);
    assert.ok(startup.menuObject.menuItems.length <= 10);

    // Check bounds (576x288), image bounds (20..288 x 20..144), borderColor (0..15), and zero overlap
    const all = [...startup.textObject, ...startup.listObject, ...startup.imageObject];
    for (const c of all) {
      assert.ok(c.xPosition >= 0 && c.yPosition >= 0);
      assert.ok(c.xPosition + c.width <= G2_WIDTH, `container ${c.containerName} exceeds G2 width`);
      assert.ok(c.yPosition + c.height <= G2_HEIGHT, `container ${c.containerName} exceeds G2 height`);
      if (c.borderWidth > 0) {
        assert.ok(c.borderColor >= 8 && c.borderColor <= 15, `borderColor must use visible 0..15 scale`);
      }
    }
    const img = startup.imageObject[0];
    assert.ok(img.width >= 20 && img.width <= 288);
    assert.ok(img.height >= 20 && img.height <= 144);

    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        assert.equal(
          boxesOverlap(all[i], all[j]),
          false,
          `Overlap between ${all[i].containerName} and ${all[j].containerName}`
        );
      }
    }
  }
});

test("2. Real G2 ~21px font character and line budgets never clip on any screen or mode", () => {
  const states = [
    ...SCREENS.map((screen) => makeBaseState({ screen })),
    makeBaseState({
      screen: "FOCUS",
      voiceRecording: true,
      voiceTranscript: "A very long spoken sentence that must wrap cleanly without ever overflowing the G2 card height",
    }),
    makeBaseState({
      screen: "MARKETS",
      markets: [
        {
          id: "long-q",
          question: "Will the Federal Reserve announce an emergency rate cut before the next scheduled FOMC press conference?",
          yesPct: 37,
          volume24h: 9800000,
          deltaPct: 4.5,
        },
      ],
    }),
  ];

  for (const st of states) {
    const hdr = buildHeaderUpgrade(st);
    const det = buildDetailUpgrade(st);
    const kpi = buildKpiUpgrade(st);
    const ftr = buildFooterUpgrade(st);
    const page = buildG2PagePayload(st);
    const listItems = page.listObject[0].itemContainer.itemName;

    assert.equal(hdr.containerID, CONTAINER_IDS.HEADER);
    assert.ok(hdr.content.length <= G2_TEXT_LIMITS.HEADER_CHARS, `Header too wide: ${hdr.content}`);
    assert.ok(!hdr.content.includes("\n"));

    const detLines = det.content.split("\n");
    assert.ok(detLines.length <= G2_TEXT_LIMITS.CARD_MAX_LINES, `Detail too tall (${detLines.length} lines)`);
    for (const line of detLines) {
      assert.ok(line.length <= G2_TEXT_LIMITS.CARD_LINE_CHARS, `Detail line too wide (${line.length}): ${line}`);
    }

    assert.ok(kpi.content.length <= G2_TEXT_LIMITS.KPI_CHARS, `KPI too wide: ${kpi.content}`);
    assert.ok(ftr.content.length <= G2_TEXT_LIMITS.FOOTER_CHARS, `Footer too wide: ${ftr.content}`);
    for (const item of listItems) {
      assert.ok(item.length <= G2_TEXT_LIMITS.LIST_ITEM_CHARS, `List row too wide: ${item}`);
    }
  }
});

test("3. 4-bit grayscale PNG generator produces valid PNG headers and ImageRawDataUpdate payloads", () => {
  const spark = renderSparklineImage(FALLBACK_CANDLES.SOL, { tag: "SOL 24H", deltaText: "+4.9%" });
  const prob = renderProbabilityBarImage(68, { deltaText: "+2.8%" });
  const wave = renderMicWaveformImage([0.2, 0.8, 0.5, 0.9, 0.3], { active: true, roleLabel: "SELF" });

  for (const g of [spark, prob, wave]) {
    assert.equal(g.width, SPARK_IMG_WIDTH);
    assert.equal(g.height, SPARK_IMG_HEIGHT);
    assert.equal(g.pixels.length, SPARK_IMG_WIDTH * SPARK_IMG_HEIGHT);
    // PNG magic signature
    assert.deepEqual(Array.from(g.pngBytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    // IHDR width & height big-endian at bytes 16..23, bitDepth=8 at 24, colorType=0 (grayscale) at 25
    const dv = new DataView(g.pngBytes.buffer, g.pngBytes.byteOffset, g.pngBytes.byteLength);
    assert.equal(dv.getUint32(16, false), SPARK_IMG_WIDTH);
    assert.equal(dv.getUint32(20, false), SPARK_IMG_HEIGHT);
    assert.equal(g.pngBytes[24], 8);
    assert.equal(g.pngBytes[25], 0);
    // Must contain lit pixels
    const lit = g.pixels.filter((v) => v > 0).length;
    assert.ok(lit > 300, `Expected visible graphic pixels, got ${lit}`);

    const upd = buildImageUpdate(g);
    assert.equal(upd.containerID, CONTAINER_IDS.SPARK_IMG);
    assert.ok(Array.isArray(upd.imageData) && upd.imageData.length === g.pngBytes.length);
  }

  // FOCUS screen switches graphic kind dynamically by linked message entity
  const gSol = buildGraphicForState(makeBaseState({ screen: "FOCUS", messageIndex: 0 }));
  assert.equal(gSol.kind, "sparkline");
  const gFomc = buildGraphicForState(makeBaseState({ screen: "FOCUS", messageIndex: 1 }));
  assert.equal(gFomc.kind, "probability");
  const gVoice = buildGraphicForState(makeBaseState({ screen: "FOCUS", voiceRecording: true }));
  assert.equal(gVoice.kind, "waveform");
});

test("4. Proto3 zero-value omission on G2 List_ItemEvent (Row 0 & undefined CLICK_EVENT) and non-double scroll", () => {
  const items = ["Voice Reply", "Reply: Trim SOL", "Next Msg (2/4)"];

  // Proto3 omits both 0 values -> must resolve to Row 0 CLICK (not stale index 2!)
  const row0Click = normalizeEvenHubListEvent({}, items, 2);
  assert.deepEqual(row0Click, { action: "CLICK", index: 0 });

  // Name fallback when index omitted
  const namedClick = normalizeEvenHubListEvent({ currentSelectItemName: "Next Msg (2/4)" }, items, 0);
  assert.deepEqual(namedClick, { action: "CLICK", index: 2 });

  // Scroll event reports firmware-updated index -> SCROLL_SYNC without double incrementing
  const scrollEv = normalizeEvenHubListEvent(
    { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT, currentSelectItemIndex: 1 },
    items,
    0
  );
  assert.equal(scrollEv.action, "SCROLL_SYNC");
  assert.equal(scrollEv.index, 1);

  // Push-to-talk long press & release
  const lp = normalizeEvenHubListEvent({ eventType: OsEventTypeList.LONG_PRESS_EVENT, currentSelectItemIndex: 0 }, items, 0);
  const lpr = normalizeEvenHubListEvent(
    { eventType: OsEventTypeList.LONG_PRESS_RELEASE_EVENT, currentSelectItemIndex: 0 },
    items,
    0
  );
  assert.equal(lp.action, "LONG_PRESS");
  assert.equal(lpr.action, "LONG_PRESS_RELEASE");
});

test("5. Real 16kHz PCM16 RMS analyzer computes silence and speech energy accurately", () => {
  const silence = new Uint8Array(640);
  assert.equal(computePcm16Rms(silence), 0);

  // Build 160 samples of ~50% amplitude S16LE sine wave
  const buf = new ArrayBuffer(320);
  const view = new DataView(buf);
  for (let i = 0; i < 160; i++) {
    const sample = Math.round(Math.sin((i / 160) * Math.PI * 8) * 12000);
    view.setInt16(i * 2, sample, true);
  }
  const rms = computePcm16Rms(new Uint8Array(buf));
  assert.ok(rms > 0.45 && rms <= 1.0, `Unexpected PCM16 RMS: ${rms}`);
});

test("6. IMU Head-Nod and Head-Shake detector triggers cleanly and respects cooldown & noise immunity", () => {
  const det = new ImuGestureDetector();
  const t0 = 10000;

  // Walking noise should not trigger
  for (let i = 0; i < 5; i++) {
    assert.equal(det.push({ x: 0.08 * (i % 2 ? 1 : -1), y: 0.1, z: 1.0 }, t0 + i * 100), null);
  }

  // Head-Nod burst -> NOD
  let detected = null;
  for (const frame of buildSyntheticImuBurst("NOD", t0 + 1000)) {
    detected = det.push(frame, frame.t) || detected;
  }
  assert.equal(detected, "NOD");

  // Immediate repeat inside cooldown window -> suppressed
  let suppressed = null;
  for (const frame of buildSyntheticImuBurst("NOD", t0 + 1500)) {
    suppressed = det.push(frame, frame.t) || suppressed;
  }
  assert.equal(suppressed, null);

  // After cooldown -> Head-Shake burst -> SHAKE
  let shake = null;
  for (const frame of buildSyntheticImuBurst("SHAKE", t0 + 4000)) {
    shake = det.push(frame, frame.t) || shake;
  }
  assert.equal(shake, "SHAKE");
});

test("7. Polymarket keyset parser filters out sports, expired, and settled odds while prioritizing Crypto/Fed", () => {
  const nowMs = Date.parse("2026-11-23T04:00:00Z");
  const keysetPayload = {
    next_cursor: "abc",
    markets: [
      { id: "nfl", question: "Vikings vs. 49ers", outcomePrices: '["0.45","0.55"]', volume24hr: 9e6, endDate: "2026-12-01T00:00:00Z" },
      { id: "nba", question: "Celtics vs. Warriors", outcomePrices: '["0.21","0.79"]', volume24hr: 5e6, endDate: "2026-12-01T00:00:00Z" },
      { id: "settled", question: "Will BTC reach $1M?", outcomePrices: '["0.01","0.99"]', volume24hr: 4e6, endDate: "2026-12-31T00:00:00Z" },
      { id: "expired", question: "Will Fed cut on Nov 20?", outcomePrices: '["0.50","0.50"]', volume24hr: 3e6, endDate: "2026-11-21T00:00:00Z" },
      { id: "macro", question: "Will NVIDIA stay top AI vendor in 2026?", outcomePrices: '["0.76","0.24"]', volume24hr: 2e6, endDate: "2026-12-31T00:00:00Z" },
      { id: "fed", question: "No change in Fed interest rates at December FOMC?", outcomePrices: '["0.68","0.32"]', volume24hr: 1.5e6, oneDayPriceChange: 0.03, endDate: "2026-12-10T00:00:00Z" },
    ],
  };

  const parsed = parsePolymarketResponse(keysetPayload, { nowMs });
  assert.equal(parsed.length, 2);
  // Tier-2 Crypto/Fed market must rank ahead of Tier-1 Macro despite slightly lower volume
  assert.equal(parsed[0].id, "fed");
  assert.equal(parsed[0].yesPct, 68);
  assert.equal(parsed[0].deltaPct, 3);
  assert.equal(parsed[1].id, "macro");
});

test("8. Hyperliquid metaAndAssetCtxs parser and candleSnapshot fetcher normalize live data", async () => {
  const hlParsed = parseHyperliquidResponse([
    { universe: [{ name: "BTC" }, { name: "SOL" }] },
    [
      { markPx: "100000", prevDayPx: "98000", funding: "0.00001", openInterest: "1000" },
      { markPx: "240", prevDayPx: "230", funding: "0.00002", openInterest: "50000" },
    ],
  ]);
  assert.equal(hlParsed.length, 2);
  assert.equal(hlParsed[0].coin, "BTC");
  assert.equal(hlParsed[0].change24h, 2.04);

  const candles = await fetchHyperliquidCandles("SOL", async (_url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.type, "candleSnapshot");
    assert.equal(body.req.coin, "SOL");
    return {
      ok: true,
      json: async () => [{ c: "220.1" }, { c: "225.4" }, { c: "231.4" }],
    };
  });
  assert.equal(candles.source, "LIVE");
  assert.deepEqual(candles.closes, [220.1, 225.4, 231.4]);
});

test("9. Entity auto-linker matches Telegram messages to Hyperliquid perps or Polymarket odds and builds contextual smart replies", () => {
  const st = makeBaseState();

  const solCtx = extractMarketContext(DEMO_TELEGRAM_INBOX[0], st);
  assert.equal(solCtx.matched, true);
  assert.equal(solCtx.kind, "perp");
  assert.equal(solCtx.perp.coin, "SOL");
  const solReplies = buildSmartReplies(DEMO_TELEGRAM_INBOX[0], solCtx, st);
  assert.equal(solReplies.length, 3);
  assert.ok(solReplies[0].text.includes("SOL"));
  assert.equal(solReplies[1].armAlert.target, "SOL");

  const fedCtx = extractMarketContext(DEMO_TELEGRAM_INBOX[1], st);
  assert.equal(fedCtx.matched, true);
  assert.equal(fedCtx.kind, "polymarket");
  assert.ok(fedCtx.market.question.includes("Fed"));
  const fedReplies = buildSmartReplies(DEMO_TELEGRAM_INBOX[1], fedCtx, st);
  assert.ok(fedReplies[0].text.includes("68% YES"));
  assert.equal(fedReplies[1].armAlert.kind, "polymarket");
});

test("10. Telegram getUpdates tracks offset, ingests both message and channel_post, and deduplicates inbox", async () => {
  let capturedUrl = "";
  const res = await fetchTelegramInbox(
    { botToken: "TOK123", offset: 500, proxyUrl: "https://relay.example.workers.dev/" },
    async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: [
            {
              update_id: 500,
              message: { message_id: 11, date: 1795320000, chat: { id: 888, title: "Desk" }, from: { first_name: "Alice" }, text: "BTC up" },
            },
            {
              update_id: 501,
              channel_post: { message_id: 12, date: 1795320060, chat: { id: -100777, title: "AlphaCh" }, caption: "SOL breakout" },
            },
          ],
        }),
      };
    }
  );

  assert.ok(capturedUrl.startsWith("https://relay.example.workers.dev/botTOK123/getUpdates?"));
  assert.ok(capturedUrl.includes("offset=500"));
  assert.ok(capturedUrl.includes("channel_post"));
  assert.equal(res.source, "LIVE");
  assert.equal(res.nextOffset, 502);
  assert.equal(res.discoveredChatId, "888");
  assert.equal(res.messages.length, 2);
  assert.equal(res.messages[0].kind, "CHANNEL");
  assert.equal(res.messages[0].text, "SOL breakout");
  assert.equal(res.messages[1].kind, "CHAT");

  const merged = mergeInboxMessages(res.messages, [res.messages[0]], 10);
  assert.equal(merged.length, 2);
});

test("11. Threaded Telegram sendMessage passes reply_to_message_id, supports proxyUrl, and handles CORS errors cleanly", async () => {
  assert.equal(resolveTelegramBaseUrl(""), "https://api.telegram.org");
  assert.equal(resolveTelegramBaseUrl("https://my-proxy.workers.dev///"), "https://my-proxy.workers.dev");

  let capturedUrl = "";
  let capturedBody = null;
  const live = await sendTelegramMessage(
    {
      botToken: "TEST_TOKEN",
      chatId: "999",
      text: "[G2 Voice] Copy, hedging half SOL",
      replyToMessageId: 42,
      proxyUrl: "https://my-proxy.workers.dev",
    },
    async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 77 } }) };
    }
  );
  assert.equal(live.mode, "LIVE");
  assert.equal(live.messageId, 77);
  assert.equal(live.replyToMessageId, 42);
  assert.equal(capturedUrl, "https://my-proxy.workers.dev/botTEST_TOKEN/sendMessage");
  assert.equal(capturedBody.reply_to_message_id, 42);

  // Actionable CORS hint when browser fetch fails without proxy
  await assert.rejects(
    () =>
      sendTelegramMessage({ botToken: "T", chatId: "9", text: "hi" }, async () => {
        throw new TypeError("Failed to fetch");
      }),
    /CORS Proxy URL/
  );
});

test("12. Alert evaluation fires once and respects persisted triggered flag", () => {
  const st = {
    perps: [{ coin: "SOL", markPx: 250, change24h: 8.0, fundingApr: 40.0, openInterestUsd: 500e6 }],
    markets: [{ id: "m1", question: "Fed rate cut?", yesPct: 80, volume24h: 9e6, deltaPct: 6 }],
    alerts: [
      { kind: "perp", target: "SOL", anchorPrice: 230, thresholdPct: 2, fundingLimit: 35, triggered: false },
      { kind: "polymarket", target: "m1", anchorPct: 70, thresholdPct: 5, triggered: false },
      { kind: "perp", target: "SOL", anchorPrice: 200, thresholdPct: 2, fundingLimit: 35, triggered: true },
    ],
  };

  const fired = evaluateAlerts(st);
  assert.equal(fired.length, 2);
  assert.ok(fired[0].reason.includes("SOL"));
  assert.ok(fired[1].reason.includes("80%"));

  // Mark triggered as main.js persists -> subsequent cycle must not re-fire
  for (const a of st.alerts) a.triggered = true;
  assert.equal(evaluateAlerts(st).length, 0);

  const summary = buildPulseSummaryText(st);
  assert.ok(summary.includes("SOL $250.00"));
  assert.ok(summary.includes("YES 80%"));
});

test("13. Real BotFather colon token works end-to-end across feeds URLs and Cloudflare Worker allowlist", async () => {
  const realToken = "123456789:ABC-DEF_xyz09";
  assert.equal(encodeTelegramBotToken(realToken), realToken);

  let getUrl = "";
  await fetchTelegramInbox(
    { botToken: realToken, proxyUrl: "https://relay.example.workers.dev" },
    async (url) => {
      getUrl = url;
      return { ok: true, json: async () => ({ ok: true, result: [] }) };
    }
  );
  assert.ok(getUrl.startsWith(`https://relay.example.workers.dev/bot${realToken}/getUpdates?`));
  assert.ok(!getUrl.includes("%3A"));

  let postUrl = "";
  await sendTelegramMessage(
    { botToken: realToken, chatId: "999", text: "Hello", proxyUrl: "https://relay.example.workers.dev" },
    async (url) => {
      postUrl = url;
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 5 } }) };
    }
  );
  assert.equal(postUrl, `https://relay.example.workers.dev/bot${realToken}/sendMessage`);

  // Worker accepts both literal ':' and percent-encoded '%3A' and normalizes upstream path
  const p1 = parseTelegramProxyPath(`/bot${realToken}/sendMessage`);
  const p2 = parseTelegramProxyPath(`/bot123456789%3AABC-DEF_xyz09/getUpdates`);
  const pBad = parseTelegramProxyPath(`/bot${realToken}/deleteWebhook`);
  assert.equal(p1?.normalizedPath, `/bot${realToken}/sendMessage`);
  assert.equal(p2?.normalizedPath, `/bot${realToken}/getUpdates`);
  assert.equal(pBad, null);
});

test("14. Toast headings reflect ERROR, CANCELED, NOTICE, and CONFIRMED accurately", () => {
  assert.equal(deriveToastHeading("TG Err: Browser CORS blocked"), "ERROR");
  assert.equal(deriveToastHeading("Reply canceled (IMU SHAKE)"), "CANCELED");
  assert.equal(deriveToastHeading("Disarmed SOL perp alert"), "CANCELED");
  assert.equal(deriveToastHeading("Synced HL:LIVE PM:LIVE TG:SIM"), "NOTICE");
  assert.equal(deriveToastHeading("Sent [LIVE]: [G2 Voice] Copy"), "CONFIRMED");

  const errDetail = buildDetailTextForScreen(makeBaseState({ toast: "TG Err: invalid token" }));
  assert.ok(errDetail.startsWith("ERROR\n"));
  const cancelDetail = buildDetailTextForScreen(makeBaseState({ toast: "Reply canceled (2xTAP)" }));
  assert.ok(cancelDetail.startsWith("CANCELED\n"));
});

test("15. MINI_FONT renders J, Q, Z, $, and / glyphs into grayscale image buffer", () => {
  const blank = renderSparklineImage([], { tag: "   " });
  const jqz = renderSparklineImage([], { tag: "JQZ" });
  const usdSlash = renderSparklineImage([], { tag: "$/+" });
  const litBlank = blank.pixels.filter((v) => v > 150).length;
  const litJqz = jqz.pixels.filter((v) => v > 150).length;
  const litUsd = usdSlash.pixels.filter((v) => v > 150).length;
  assert.ok(litJqz > litBlank + 20, `Expected J, Q, Z pixels to render (blank=${litBlank}, jqz=${litJqz})`);
  assert.ok(litUsd > litBlank + 12, `Expected $, / pixels to render (blank=${litBlank}, usdSlash=${litUsd})`);
});

test("16. FOREGROUND_EXIT_EVENT aborts active recording cleanly without drafting reply or arming IMU, and proto3 sysEvent CLICK works", async () => {
  const st = getControllerState();
  st.screen = "FOCUS";
  st.selectedIndex = 0;
  st.pendingReply = null;
  st.imuActive = false;
  st.voiceRecording = false;

  // Start recording via R1 Ring LONG_PRESS_EVENT
  handleSdkEvent({
    sysEvent: {
      eventType: OsEventTypeList.LONG_PRESS_EVENT,
      eventSource: EventSourceType.TOUCH_EVENT_FROM_RING,
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(st.voiceRecording, true);

  // App exits foreground while recording -> must abort cleanly with NO draft & NO IMU armed
  handleSdkEvent({
    sysEvent: {
      eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT,
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(st.voiceRecording, false);
  assert.equal(st.pendingReply, null);
  assert.equal(st.imuActive, false);

  // Proto3 zero-omitted sysEvent CLICK (eventType=undefined, eventSource=RING) activates Row 0 cleanly
  handleSdkEvent({
    sysEvent: {
      eventType: undefined,
      eventSource: EventSourceType.TOUCH_EVENT_FROM_RING,
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(st.voiceRecording, true);
  // Clean up timer so node:test exits promptly
  handleSdkEvent({
    sysEvent: { eventType: OsEventTypeList.SYSTEM_EXIT_EVENT },
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(st.voiceRecording, false);
});

test("17. Hyperliquid clearinghouseState parser & wallet fetcher handle mainnet/testnet, sorting, invalid addresses, and honest error fallback", async () => {
  assert.equal(resolveHyperliquidUrl("mainnet"), HYPERLIQUID_ENDPOINTS.mainnet);
  assert.equal(resolveHyperliquidUrl("testnet"), HYPERLIQUID_ENDPOINTS.testnet);
  assert.equal(isValidEvmAddress(PRESET_WALLETS.mainnet.address), true);
  assert.equal(isValidEvmAddress("0x1234"), false);

  const sampleRaw = {
    marginSummary: {
      accountValue: "3171586.24",
      totalNtlPos: "2776518.00",
      totalMarginUsed: "138825.90",
    },
    withdrawable: "2893934.43",
    assetPositions: [
      {
        type: "oneWay",
        position: {
          coin: "BTC",
          szi: "-0.05358",
          leverage: { type: "cross", value: 20 },
          entryPx: "60015.8",
          positionValue: "3203.82",
          unrealizedPnl: "11.83",
          returnOnEquity: "0.0736",
          marginUsed: "160.19",
          liquidationPx: "58154123.3",
        },
      },
      {
        type: "oneWay",
        position: {
          coin: "ETH",
          szi: "4.5",
          leverage: { type: "cross", value: 10 },
          entryPx: "3200.0",
          positionValue: "15300.0",
          unrealizedPnl: "420.55",
          returnOnEquity: "0.275",
          marginUsed: "1530.0",
          liquidationPx: "2800.0",
        },
      },
      {
        type: "oneWay",
        position: { coin: "ZERO", szi: "0", positionValue: "0", unrealizedPnl: "0" },
      },
    ],
  };

  const parsed = parseClearinghouseState(sampleRaw, {
    address: PRESET_WALLETS.mainnet.address,
    network: "mainnet",
  });
  assert.equal(parsed.totalPositionCount, 2);
  assert.equal(parsed.positions[0].coin, "ETH"); // sorted by notional descending
  assert.equal(parsed.positions[0].side, "LONG");
  assert.equal(parsed.positions[1].coin, "BTC");
  assert.equal(parsed.positions[1].side, "SHORT");
  assert.equal(parsed.totalUnrealizedPnl, 432.38);
  assert.equal(parsed.marginRatioPct, 4.4);

  // Live testnet fetcher routes to hyperliquid-testnet URL with clearinghouseState body
  let calledUrl = "";
  let calledBody = null;
  const liveTestnet = await fetchHyperliquidWallet(
    { address: PRESET_WALLETS.testnet.address, network: "testnet" },
    async (url, opts) => {
      calledUrl = url;
      calledBody = JSON.parse(opts.body);
      return { ok: true, json: async () => sampleRaw };
    }
  );
  assert.equal(calledUrl, HYPERLIQUID_ENDPOINTS.testnet);
  assert.equal(calledBody.type, "clearinghouseState");
  assert.equal(calledBody.user, PRESET_WALLETS.testnet.address);
  assert.equal(liveTestnet.source, "LIVE");
  assert.equal(liveTestnet.wallet.network, "testnet");

  // Invalid address returns INVALID with null wallet (zero fake data)
  const invalidRes = await fetchHyperliquidWallet({ address: "not-an-address", network: "mainnet" });
  assert.equal(invalidRes.source, "INVALID");
  assert.equal(invalidRes.wallet, null);

  // Network failure returns honest ERROR with null wallet (zero fabricated positions)
  const errRes = await fetchHyperliquidWallet(
    { address: PRESET_WALLETS.mainnet.address, network: "mainnet" },
    async () => {
      throw new Error("timeout");
    }
  );
  assert.equal(errRes.source, "ERROR");
  assert.equal(errRes.wallet, null);
});

test("18. Voice command intent parser handles paper perp orders, Polymarket paper bets, and passes Telegram replies cleanly", () => {
  const ctx = { perps: FALLBACK_HYPERLIQUID, markets: FALLBACK_POLYMARKET };

  const longBtc = parseVoiceTradeIntent("Long BTC 100", ctx);
  assert.equal(longBtc?.kind, "PAPER_PERP");
  assert.equal(longBtc.side, "LONG");
  assert.equal(longBtc.coin, "BTC");
  assert.equal(longBtc.sizeUsd, 100);
  assert.equal(longBtc.leverage, 3);
  assert.equal(longBtc.entryPx, FALLBACK_HYPERLIQUID[0].markPx);

  const shortEth = parseVoiceTradeIntent("Short ETH $250 5x", ctx);
  assert.equal(shortEth?.kind, "PAPER_PERP");
  assert.equal(shortEth.side, "SHORT");
  assert.equal(shortEth.coin, "ETH");
  assert.equal(shortEth.sizeUsd, 250);
  assert.equal(shortEth.leverage, 5);
  assert.equal(shortEth.marginUsd, 50);

  const reversedOrder = parseVoiceTradeIntent("Buy $150 SOL", ctx);
  assert.equal(reversedOrder?.kind, "PAPER_PERP");
  assert.equal(reversedOrder.side, "LONG");
  assert.equal(reversedOrder.coin, "SOL");
  assert.equal(reversedOrder.sizeUsd, 150);

  const betFed = parseVoiceTradeIntent("Bet Yes 50 on Fed", ctx);
  assert.equal(betFed?.kind, "PAPER_BET");
  assert.equal(betFed.outcome, "YES");
  assert.equal(betFed.stakeUsd, 50);
  assert.equal(betFed.marketId, "pm-fed-dec");
  assert.equal(betFed.entryOddsPct, 68);
  assert.ok(betFed.maxPayoutUsd > 73 && betFed.maxPayoutUsd < 74);

  const betNoBtc = parseVoiceTradeIntent("Bet $25 No on Bitcoin", ctx);
  assert.equal(betNoBtc?.kind, "PAPER_BET");
  assert.equal(betNoBtc.outcome, "NO");
  assert.equal(betNoBtc.stakeUsd, 25);
  assert.equal(betNoBtc.marketId, "pm-btc-100k");
  assert.equal(betNoBtc.entryOddsPct, 46);

  // Regular Telegram conversational reply must return null (falls through to Telegram draft)
  assert.equal(parseVoiceTradeIntent("Trim half SOL now, arm 2% alert", ctx), null);
  assert.equal(parseVoiceTradeIntent("Back at desk in 5m, keep hedge on", ctx), null);
});

test("19. Non-custodial paper order/bet execution tracks live mark-to-market uPnL, guards cash, and realizes PnL on close", () => {
  let book = createDefaultPaperBook(1000);
  const perpsT0 = [
    { coin: "BTC", markPx: 100000, change24h: 1.0, fundingApr: 10, openInterestUsd: 1e9 },
    { coin: "ETH", markPx: 3000, change24h: 0.5, fundingApr: 10, openInterestUsd: 5e8 },
  ];
  const marketsT0 = [
    { id: "pm-fed-dec", question: "No change in Fed rates after next FOMC?", yesPct: 50, volume24h: 5e6, deltaPct: 1 },
  ];

  // Open LONG BTC $300 3x ($100 margin) + BET YES $100 @50% (200 shares)
  const btcIntent = parseVoiceTradeIntent("Long BTC 300 3x", { perps: perpsT0, markets: marketsT0 });
  const r1 = executePaperIntent(book, btcIntent, 1000);
  assert.equal(r1.ok, true);
  book = r1.book;
  assert.equal(book.cashUsd, 900);

  const betIntent = parseVoiceTradeIntent("Bet Yes 100 on Fed", { perps: perpsT0, markets: marketsT0 });
  const r2 = executePaperIntent(book, betIntent, 2000);
  assert.equal(r2.ok, true);
  book = r2.book;
  assert.equal(book.cashUsd, 800);

  // Insufficient cash guard
  const tooBig = parseVoiceTradeIntent("Long BTC 9000 1x", { perps: perpsT0, markets: marketsT0 });
  const rErr = executePaperIntent(book, tooBig, 2500);
  assert.equal(rErr.ok, false);
  assert.match(rErr.error, /Insufficient paper cash/);

  // Live prices move: BTC +10% -> $110,000 (+$30 uPnL on $300 notional), Fed YES 50% -> 65% (+$30 uPnL on 200 shares)
  const perpsT1 = [{ ...perpsT0[0], markPx: 110000 }, perpsT0[1]];
  const marketsT1 = [{ ...marketsT0[0], yesPct: 65 }];
  const metrics = computePaperPortfolioMetrics(book, { perps: perpsT1, markets: marketsT1 });
  assert.equal(metrics.perps[0].uPnlUsd, 30);
  assert.equal(metrics.bets[0].uPnlUsd, 30);
  assert.equal(metrics.unrealizedPnlUsd, 60);
  assert.equal(metrics.totalEquityUsd, 1060);

  // Close perp -> realizes +$30 and returns $130 to cash
  const c1 = closePaperPosition(book, r1.record.id, { perps: perpsT1, markets: marketsT1 }, 3000);
  assert.equal(c1.ok, true);
  assert.equal(c1.realizedPnlUsd, 30);
  assert.equal(c1.book.cashUsd, 930);
  assert.equal(c1.book.realizedPnlUsd, 30);
  assert.equal(c1.book.perpOrders.length, 0);
});

test("20. WALLET screen (incl. 6 HL positions & NO-bet fallback) and pending Order/Bet tickets obey strict G2 <=26x3 budgets", () => {
  const coins = ["BTC", "ETH", "SOL", "HYPE", "SUI", "ARB"];
  const wallet = parseClearinghouseState(
    {
      marginSummary: { accountValue: "3171586.24", totalNtlPos: "2776518.00", totalMarginUsed: "138825.90" },
      withdrawable: "2893934.43",
      assetPositions: coins.map((coin, i) => ({
        type: "oneWay",
        position: {
          coin,
          szi: i % 2 === 0 ? "-0.5" : "2.0",
          leverage: { type: "cross", value: 20 },
          entryPx: "1000",
          positionValue: String(60000 - i * 5000),
          unrealizedPnl: String(420 - i * 50),
          returnOnEquity: "0.176",
          marginUsed: "2375",
        },
      })),
    },
    { address: PRESET_WALLETS.mainnet.address, network: "mainnet" }
  );

  let book = createDefaultPaperBook(10000);
  const perpIntent = parseVoiceTradeIntent("Long BTC 100", { perps: FALLBACK_HYPERLIQUID, markets: FALLBACK_POLYMARKET });
  const betIntent = parseVoiceTradeIntent("Bet Yes 50 on Fed", { perps: FALLBACK_HYPERLIQUID, markets: FALLBACK_POLYMARKET });
  const noBetIntent = parseVoiceTradeIntent("Bet No 40 on Fed", { perps: FALLBACK_HYPERLIQUID, markets: FALLBACK_POLYMARKET });
  book = executePaperIntent(book, perpIntent, 1000).book;
  book = executePaperIntent(book, betIntent, 2000).book;

  const scenarios = [
    makeBaseState({ screen: "WALLET", walletSource: "LIVE", walletData: wallet, paperBook: book, selectedIndex: 0 }),
    makeBaseState({ screen: "WALLET", walletSource: "LIVE", walletData: wallet, paperBook: book, selectedIndex: 1 }),
    makeBaseState({ screen: "WALLET", walletSource: "LIVE", walletData: wallet, paperBook: book, selectedIndex: 2 }),
    makeBaseState({ screen: "WALLET", walletSource: "LIVE", walletData: wallet, paperBook: book, selectedIndex: 8 }), // 6th HL pos (ARB)
    makeBaseState({ screen: "WALLET", walletSource: "ERROR", walletData: null, walletError: "Hyperliquid HTTP 503", paperBook: book }),
    makeBaseState({ screen: "FOCUS", pendingTrade: perpIntent, imuActive: true }),
    makeBaseState({ screen: "MARKETS", pendingTrade: betIntent, imuActive: true }),
  ];

  // All 6 HL positions must map cleanly into WALLET list entries (matches companion table's 6 rows)
  const entries = buildWalletListEntries(scenarios[0]);
  assert.ok(entries.some((e) => e.kind === "HL_POS" && e.item?.coin === "ARB"), "Expected 6th HL position (ARB) in G2 WALLET list");

  for (const st of scenarios) {
    const page = buildG2PagePayload(st, { isStartup: false });
    assert.equal(validateEvenHubPageContainer(page).valid, true);

    const hdr = buildHeaderUpgrade(st);
    const det = buildDetailUpgrade(st);
    const kpi = buildKpiUpgrade(st);
    const ftr = buildFooterUpgrade(st);
    const listItems = page.listObject[0].itemContainer.itemName;

    assert.ok(hdr.content.length <= G2_TEXT_LIMITS.HEADER_CHARS, `Header too wide: ${hdr.content}`);
    const detLines = det.content.split("\n");
    assert.ok(detLines.length <= G2_TEXT_LIMITS.CARD_MAX_LINES, `Detail too tall: ${det.content}`);
    for (const l of detLines) {
      assert.ok(l.length <= G2_TEXT_LIMITS.CARD_LINE_CHARS, `Detail line too wide (${l.length}): ${l}`);
    }
    assert.ok(kpi.content.length <= G2_TEXT_LIMITS.KPI_CHARS, `KPI too wide: ${kpi.content}`);
    assert.ok(ftr.content.length <= G2_TEXT_LIMITS.FOOTER_CHARS, `Footer too wide: ${ftr.content}`);
    for (const item of listItems) {
      assert.ok(item.length <= G2_TEXT_LIMITS.LIST_ITEM_CHARS, `List row too wide: ${item}`);
    }
  }

  // Pending perp order displays sparkline; pending Polymarket bet displays probability gauge
  assert.equal(buildGraphicForState(scenarios[5]).kind, "sparkline");
  assert.equal(buildGraphicForState(scenarios[6]).kind, "probability");

  // NO-bet graphic fallback when live market is absent must render YES% (68%), NOT inverted NO% (32%)
  const noBook = executePaperIntent(createDefaultPaperBook(10000), noBetIntent, 3000).book;
  const noStateOffline = makeBaseState({
    screen: "WALLET",
    markets: [],
    paperBook: noBook,
    selectedIndex: 1, // PAPER_BET row
  });
  const gNoFallback = buildGraphicForState(noStateOffline);
  const gExpectedYes68 = renderProbabilityBarImage(68, { deltaText: "+$0.00" });
  const gWrongYes32 = renderProbabilityBarImage(32, { deltaText: "+$0.00" });
  assert.deepEqual(Array.from(gNoFallback.pixels), Array.from(gExpectedYes68.pixels));
  assert.notDeepEqual(Array.from(gNoFallback.pixels), Array.from(gWrongYes32.pixels));
});

test("21. Controller voice-trade -> IMU Head-Nod dynamically selects newly filled perp & bet rows, IMU Head-Shake & 2xTap cancel cleanly", async () => {
  const st = getControllerState();
  st.paperBook = createDefaultPaperBook(10000);
  st.pendingTrade = null;
  st.pendingReply = null;
  st.imuActive = false;

  // Draft paper perp order via voice command router
  const drafted = await submitVoiceCommandText("Long BTC 100");
  assert.equal(drafted?.kind, "PAPER_PERP");
  assert.equal(st.pendingTrade?.coin, "BTC");
  assert.equal(st.imuActive, true);

  // Confirm via IMU Head-Nod burst through official handleSdkEvent pipeline
  for (const frame of buildSyntheticImuBurst("NOD", Date.now())) {
    handleSdkEvent({
      sysEvent: { eventType: OsEventTypeList.IMU_DATA_REPORT, imuData: frame },
    });
  }
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(st.pendingTrade, null);
  assert.equal(st.imuActive, false);
  assert.equal(st.paperBook.perpOrders.length, 1);
  assert.equal(st.paperBook.perpOrders[0].coin, "BTC");
  assert.equal(st.screen, "WALLET");
  assert.equal(st.selectedIndex, 1); // Row 1 = newly created PAPER_PERP

  // Draft Polymarket bet while PAPER_PERP already exists -> IMU Nod must dynamically highlight PAPER_BET (Row 2) + probability gauge!
  const betExecDraft = await submitVoiceCommandText("Bet Yes 50 on Fed");
  assert.equal(betExecDraft?.kind, "PAPER_BET");
  for (const frame of buildSyntheticImuBurst("NOD", Date.now())) {
    handleSdkEvent({
      sysEvent: { eventType: OsEventTypeList.IMU_DATA_REPORT, imuData: frame },
    });
  }
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(st.paperBook.polyBets.length, 1);
  assert.equal(st.screen, "WALLET");
  const entriesAfterBet = buildWalletListEntries(st);
  assert.equal(entriesAfterBet[st.selectedIndex]?.kind, "PAPER_BET");
  assert.equal(entriesAfterBet[st.selectedIndex]?.item?.id, st.paperBook.polyBets[0].id);
  assert.equal(buildGraphicForState(st).kind, "probability");

  // Draft another Polymarket bet then cancel via real IMU Head-Shake burst through handleSdkEvent
  const betDraft = await submitVoiceCommandText("Bet No 25 on Bitcoin");
  assert.equal(betDraft?.kind, "PAPER_BET");
  assert.equal(st.pendingTrade?.outcome, "NO");
  assert.equal(st.imuActive, true);

  for (const frame of buildSyntheticImuBurst("SHAKE", Date.now())) {
    handleSdkEvent({
      sysEvent: { eventType: OsEventTypeList.IMU_DATA_REPORT, imuData: frame },
    });
  }
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(st.pendingTrade, null);
  assert.equal(st.imuActive, false);
  assert.equal(st.paperBook.polyBets.length, 1);

  // Also verify DOUBLE_CLICK_EVENT cancels a pending trade cleanly
  await submitVoiceCommandText("Short ETH 250");
  assert.equal(st.pendingTrade?.coin, "ETH");
  handleSdkEvent({
    sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT },
  });
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(st.pendingTrade, null);
  assert.equal(st.imuActive, false);
  assert.equal(st.paperBook.perpOrders.length, 1);

  // Clear toast timer so node:test exits cleanly
  if (st.toastTimer) {
    clearTimeout(st.toastTimer);
    st.toastTimer = null;
  }
});

test("22. On-device push-to-talk fallback without Web Speech marks DEMO_FALLBACK honestly on trade & reply previews", async () => {
  const st = getControllerState();
  st.pendingTrade = null;
  st.pendingReply = null;
  st.voiceRecording = false;
  st.voiceTranscript = "";
  st.voiceTranscriptSource = "IDLE";

  // 1) Push-to-talk on PERPS without browser Web Speech -> DEMO_FALLBACK paper order
  st.screen = "PERPS";
  st.selectedIndex = 0;
  handleSdkEvent({
    sysEvent: {
      eventType: OsEventTypeList.LONG_PRESS_EVENT,
      eventSource: EventSourceType.TOUCH_EVENT_FROM_RING,
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(st.voiceRecording, true);
  assert.equal(st.voiceTranscriptSource, "DEMO_FALLBACK");
  const recHdr = buildHeaderUpgrade(st);
  assert.ok(recHdr.content.includes("DEMO"), `Expected DEMO tag in recording header: ${recHdr.content}`);
  assert.ok(recHdr.content.length <= G2_TEXT_LIMITS.HEADER_CHARS);

  handleSdkEvent({
    sysEvent: {
      eventType: OsEventTypeList.LONG_PRESS_RELEASE_EVENT,
      eventSource: EventSourceType.TOUCH_EVENT_FROM_RING,
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(st.voiceRecording, false);
  assert.equal(st.pendingTrade?.kind, "PAPER_PERP");
  assert.equal(st.pendingTrade?.transcriptSource, "DEMO_FALLBACK");
  const tradePage = buildG2PagePayload(st);
  assert.equal(validateEvenHubPageContainer(tradePage).valid, true);
  const tradeHdr = buildHeaderUpgrade(st);
  assert.ok(tradeHdr.content.includes("PAPER/DEMO"), `Expected PAPER/DEMO header: ${tradeHdr.content}`);
  assert.ok(tradeHdr.content.length <= G2_TEXT_LIMITS.HEADER_CHARS);

  // Cancel trade resets transcript source to IDLE
  handleSdkEvent({ sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(st.pendingTrade, null);
  assert.equal(st.voiceTranscriptSource, "IDLE");

  // 2) Push-to-talk on FOCUS without Web Speech -> DEMO_FALLBACK Telegram reply
  st.screen = "FOCUS";
  st.messageIndex = 0;
  handleSdkEvent({
    sysEvent: {
      eventType: OsEventTypeList.LONG_PRESS_EVENT,
      eventSource: EventSourceType.TOUCH_EVENT_FROM_GLASSES_R,
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  handleSdkEvent({
    sysEvent: {
      eventType: OsEventTypeList.LONG_PRESS_RELEASE_EVENT,
      eventSource: EventSourceType.TOUCH_EVENT_FROM_GLASSES_R,
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(st.pendingReply?.transcriptSource, "DEMO_FALLBACK");
  const replyHdr = buildHeaderUpgrade(st);
  assert.ok(replyHdr.content.includes("DEMO"), `Expected DEMO tag in reply confirm header: ${replyHdr.content}`);
  assert.ok(replyHdr.content.length <= G2_TEXT_LIMITS.HEADER_CHARS);

  // 3) Typed command via submitVoiceCommandText is marked TYPED (not DEMO_FALLBACK)
  await submitVoiceCommandText("Short ETH 250");
  assert.equal(st.pendingTrade?.transcriptSource, "TYPED");
  const typedHdr = buildHeaderUpgrade(st);
  assert.ok(!typedHdr.content.includes("DEMO"), `Typed order should not show DEMO tag: ${typedHdr.content}`);

  // Clean up
  handleSdkEvent({ sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } });
  await new Promise((r) => setTimeout(r, 20));
  if (st.toastTimer) {
    clearTimeout(st.toastTimer);
    st.toastTimer = null;
  }
});


