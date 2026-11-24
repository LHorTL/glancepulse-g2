/**
 * Even Realities G2 hardware signal helpers:
 *   1. Proto3-safe `List_ItemEvent` normalizer (handles omitted `0` -> `undefined`
 *      for both `CLICK_EVENT` and Row 0 `currentSelectItemIndex`).
 *   2. Real 16kHz Mono PCM16 (`AudioEvent.audioPcm`) RMS voice energy meter.
 *   3. `ImuGestureDetector` for hands-free Head-Nod (confirm) / Head-Shake (cancel)
 *      over `OsEventTypeList.IMU_DATA_REPORT`.
 */

import { OsEventTypeList } from "@evenrealities/even_hub_sdk";

/**
 * Normalize an incoming EvenHub `listEvent` safely against G2 protobuf quirks:
 *   - Proto3 omits default integer 0, so `CLICK_EVENT (0)` and Row 0 index `(0)`
 *     frequently deserialize as `undefined`.
 *   - Resolves `selectedIndex` from numeric index -> `currentSelectItemName` -> `0`.
 *   - Distinguishes scroll updates from clicks so callers never double-step.
 */
export function normalizeEvenHubListEvent(ev, currentItems = [], fallbackIndex = 0) {
  if (!ev || typeof ev !== "object") {
    return { action: "NONE", index: fallbackIndex };
  }

  let index;
  if (typeof ev.currentSelectItemIndex === "number" && Number.isFinite(ev.currentSelectItemIndex)) {
    index = ev.currentSelectItemIndex;
  } else if (typeof ev.currentSelectItemName === "string" && currentItems.length > 0) {
    const matched = currentItems.indexOf(ev.currentSelectItemName);
    index = matched >= 0 ? matched : 0;
  } else {
    // Proto3 omits index 0 on the wire when tapping/selecting Row 0
    index = 0;
  }

  const maxIdx = Math.max(0, currentItems.length - 1);
  if (currentItems.length > 0) {
    index = Math.max(0, Math.min(index, maxIdx));
  }

  const t = ev.eventType;
  if (t === undefined || t === null || t === OsEventTypeList.CLICK_EVENT || t === 0) {
    return { action: "CLICK", index };
  }
  if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    return { action: "DOUBLE_CLICK", index };
  }
  if (t === OsEventTypeList.LONG_PRESS_EVENT) {
    return { action: "LONG_PRESS", index };
  }
  if (t === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) {
    return { action: "LONG_PRESS_RELEASE", index };
  }
  if (t === OsEventTypeList.SCROLL_TOP_EVENT || t === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    // Firmware already moved the list cursor and reported `currentSelectItemIndex`.
    return {
      action: "SCROLL_SYNC",
      index,
      direction: t === OsEventTypeList.SCROLL_TOP_EVENT ? -1 : 1,
    };
  }
  return { action: "SYNC", index };
}

/**
 * Compute normalized [0..1] RMS energy from Even G2 16kHz Mono S16LE PCM bytes.
 */
export function computePcm16Rms(pcmBytes) {
  if (!pcmBytes || pcmBytes.length < 2) return 0;
  const view =
    pcmBytes instanceof Uint8Array
      ? new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength)
      : new DataView(Uint8Array.from(pcmBytes).buffer);
  const sampleCount = Math.floor(view.byteLength / 2);
  if (sampleCount <= 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < sampleCount; i++) {
    const s = view.getInt16(i * 2, true) / 32768;
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / sampleCount);
  // Boost speech dynamics mildly so normal voice fills 0.25..0.95 cleanly
  return Math.max(0, Math.min(1, rms * 2.4));
}

/**
 * Lightweight IMU Head-Nod (Confirm) and Head-Shake (Cancel) detector.
 * Processes `{ x, y, z }` reports from `sysEvent.imuData` (`IMU_DATA_REPORT`).
 *
 * Convention:
 *   - Pitch (nodding up/down) drives `y` (or delta-y) excursions while `x` stays calm.
 *   - Yaw (shaking left/right) drives alternating `x` sign reversals while `y` stays calm.
 */
export class ImuGestureDetector {
  constructor({ nodThreshold = 0.55, shakeThreshold = 0.55, windowMs = 1100, cooldownMs = 1400 } = {}) {
    this.nodThreshold = nodThreshold;
    this.shakeThreshold = shakeThreshold;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
    this.samples = [];
    this.lastTriggerMs = -Infinity;
  }

  reset() {
    this.samples = [];
    this.lastTriggerMs = -Infinity;
  }

  /**
   * Push one `{ x, y, z }` IMU reading. Returns `"NOD" | "SHAKE" | null`.
   */
  push(imuData, nowMs = Date.now()) {
    if (!imuData) return null;
    const x = Number(imuData.x ?? 0);
    const y = Number(imuData.y ?? 0);
    const z = Number(imuData.z ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;

    this.samples.push({ x, y, z, t: nowMs });
    const cutoff = nowMs - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].t < cutoff) {
      this.samples.shift();
    }

    if (nowMs - this.lastTriggerMs < this.cooldownMs || this.samples.length < 3) {
      return null;
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const s of this.samples) {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.y > maxY) maxY = s.y;
    }

    const spanX = maxX - minX;
    const spanY = maxY - minY;

    // Require clear dominance of one axis + opposing polarity swing
    if (spanY >= this.nodThreshold * 2 && spanY > spanX * 1.45 && minY < -this.nodThreshold * 0.4 && maxY > this.nodThreshold * 0.4) {
      this.lastTriggerMs = nowMs;
      this.samples = [];
      return "NOD";
    }
    if (spanX >= this.shakeThreshold * 2 && spanX > spanY * 1.45 && minX < -this.shakeThreshold * 0.4 && maxX > this.shakeThreshold * 0.4) {
      this.lastTriggerMs = nowMs;
      this.samples = [];
      return "SHAKE";
    }
    return null;
  }
}

/**
 * Generate synthetic IMU burst frames for browser simulator testing (passes through
 * the exact same `ImuGestureDetector` pipeline as hardware `IMU_DATA_REPORT`).
 */
export function buildSyntheticImuBurst(gesture, startMs = Date.now()) {
  if (gesture === "NOD") {
    return [
      { x: 0.02, y: 0.0, z: 1.0, t: startMs },
      { x: 0.03, y: -0.78, z: 0.92, t: startMs + 160 },
      { x: 0.01, y: 0.72, z: 0.96, t: startMs + 340 },
    ];
  }
  return [
    { x: 0.0, y: 0.02, z: 1.0, t: startMs },
    { x: -0.82, y: 0.04, z: 0.98, t: startMs + 160 },
    { x: 0.79, y: -0.02, z: 0.99, t: startMs + 340 },
  ];
}
