import test from "node:test";
import assert from "node:assert/strict";
import { validateEvenHubPageContainer } from "@evenrealities/even_hub_sdk";
import {
  FALLBACK_HYPERLIQUID,
  FALLBACK_POLYMARKET,
  DEMO_TELEGRAM_INBOX,
  parsePolymarketResponse,
  parseHyperliquidResponse,
  buildPulseSummaryText,
  evaluateAlerts,
  sendTelegramMessage,
} from "../src/feeds.js";
import {
  SCREENS,
  buildG2PagePayload,
  buildDetailUpgrade,
  buildHeaderUpgrade,
} from "../src/g2-layout.js";

test("all 4 G2 screens construct protocol-valid EvenHub SDK page containers", () => {
  const baseState = {
    screen: "PULSE",
    selectedIndex: 0,
    nowMs: 1763865600000,
    hlSource: "LIVE",
    pmSource: "LIVE",
    tgSource: "LIVE",
    batteryLevel: 88,
    perps: FALLBACK_HYPERLIQUID,
    markets: FALLBACK_POLYMARKET,
    messages: DEMO_TELEGRAM_INBOX,
    alerts: [{ kind: "perp", target: "BTC", anchorPrice: 95000, thresholdPct: 2, fundingLimit: 30, triggered: false }],
    toast: "",
  };

  for (const screen of SCREENS) {
    const startup = buildG2PagePayload({ ...baseState, screen }, { isStartup: true });
    const rebuild = buildG2PagePayload({ ...baseState, screen }, { isStartup: false });

    assert.equal(validateEvenHubPageContainer(startup).valid, true, `startup invalid for ${screen}`);
    assert.equal(validateEvenHubPageContainer(rebuild).valid, true, `rebuild invalid for ${screen}`);
    assert.equal(startup.containerTotalNum, 4);
    assert.equal(startup.listObject.length, 1);
    assert.equal(startup.textObject.length, 3);
    assert.ok(startup.menuObject.menuItems.length <= 10);
  }

  const hdrUp = buildHeaderUpgrade(baseState);
  const detUp = buildDetailUpgrade(baseState);
  assert.equal(hdrUp.containerID, 1);
  assert.equal(detUp.containerID, 3);
  assert.ok(hdrUp.content.includes("GLANCEPULSE"));
});

test("Polymarket and Hyperliquid parsers normalize live payloads safely", () => {
  const pmParsed = parsePolymarketResponse([
    {
      id: "123",
      question: "Will ETH reach $5k?",
      outcomePrices: '["0.42","0.58"]',
      volume24hr: 4500000,
      oneDayPriceChange: 0.035,
      slug: "eth-5k",
    },
    { id: "bad", question: "Resolved", outcomePrices: '["1","0"]' },
  ]);
  assert.equal(pmParsed.length, 1);
  assert.equal(pmParsed[0].yesPct, 42);
  assert.equal(pmParsed[0].deltaPct, 3.5);

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
  assert.ok(hlParsed[0].fundingApr > 8 && hlParsed[0].fundingApr < 9);
});

test("Alert evaluation and Telegram Read+Write formatting work cleanly", async () => {
  const state = {
    perps: [{ coin: "SOL", markPx: 250, change24h: 8.0, fundingApr: 40.0, openInterestUsd: 500e6 }],
    markets: [{ id: "m1", question: "Rate cut?", yesPct: 80, volume24h: 9e6, deltaPct: 6 }],
    alerts: [
      { kind: "perp", target: "SOL", anchorPrice: 230, thresholdPct: 2, fundingLimit: 35, triggered: false },
      { kind: "polymarket", target: "m1", anchorPct: 70, thresholdPct: 5, triggered: false },
    ],
  };

  const fired = evaluateAlerts(state);
  assert.equal(fired.length, 2);
  assert.ok(fired[0].reason.includes("SOL"));
  assert.ok(fired[1].reason.includes("80%"));

  const summary = buildPulseSummaryText(state);
  assert.ok(summary.includes("SOL $250.00"));
  assert.ok(summary.includes("YES 80%"));

  // Demo outbox send (no token)
  const demoReceipt = await sendTelegramMessage({ botToken: "", chatId: "", text: summary });
  assert.equal(demoReceipt.ok, true);
  assert.equal(demoReceipt.mode, "DEMO");

  // Live Bot API send via mocked fetch
  let capturedUrl = "";
  let capturedBody = null;
  const liveReceipt = await sendTelegramMessage(
    { botToken: "TEST_TOKEN", chatId: "999", text: "Hello G2" },
    async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 77 } }) };
    }
  );
  assert.equal(liveReceipt.mode, "LIVE");
  assert.equal(liveReceipt.messageId, 77);
  assert.ok(capturedUrl.includes("/sendMessage"));
  assert.equal(capturedBody.chat_id, "999");
});
