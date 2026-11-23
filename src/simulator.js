/**
 * Authentic Even Realities G2 576x288 Monochrome Green Optical Waveguide Renderer (v2.0).
 *
 * Faithfully mirrors physical G2 hardware constraints:
 *   - 4-bit monochrome green micro-LED luminance (16 shades for images & borders 0..15)
 *   - 5 discrete text brightness levels (0..4)
 *   - Fixed G2-proportioned system typography (~17-18px mono matching G2's ~21px proportional font
 *     at ~38-40 chars across 560px and ~26 chars across 368px — exposing any overflow honestly!)
 *   - Renders `textObject`, `listObject`, `imageObject` (via real 4-bit pixel buffer), and `menuObject`.
 */

import { G2_WIDTH, G2_HEIGHT, CONTAINER_IDS } from "./g2-layout.js";

const TEXT_BRIGHTNESS_PALETTE = {
  0: "rgba(57, 255, 156, 0.20)",
  1: "rgba(57, 255, 156, 0.42)",
  2: "rgba(57, 255, 156, 0.65)",
  3: "rgba(57, 255, 156, 0.86)",
  4: "#39ff9c",
};

function textLevelColor(level, fallback = 4) {
  const key = level === undefined || level === null ? fallback : Math.max(0, Math.min(4, Math.round(Number(level))));
  return TEXT_BRIGHTNESS_PALETTE[key] || TEXT_BRIGHTNESS_PALETTE[4];
}

function borderLevelColor(level, fallback = 10) {
  const n = level === undefined || level === null ? fallback : Math.max(0, Math.min(15, Math.round(Number(level))));
  if (n <= 0) return "transparent";
  const alpha = (n / 15) * 0.92;
  return `rgba(57, 255, 156, ${alpha.toFixed(3)})`;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r || 0, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function drawGrayscaleBuffer(ctx, graphic, x, y, w, h) {
  if (!graphic?.pixels) return;
  const gw = graphic.width || w;
  const gh = graphic.height || h;
  const imgData = ctx.createImageData(gw, gh);
  const dst = imgData.data;
  const src = graphic.pixels;

  for (let i = 0; i < gw * gh; i++) {
    // Quantize to G2 4-bit green waveguide luminance
    const q = (src[i] >> 4) * 17;
    const o = i * 4;
    if (q === 0) {
      dst[o] = 0;
      dst[o + 1] = 0;
      dst[o + 2] = 0;
      dst[o + 3] = 0;
    } else {
      const f = q / 255;
      dst[o] = Math.round(57 * f);
      dst[o + 1] = Math.round(255 * f);
      dst[o + 2] = Math.round(156 * f);
      dst[o + 3] = Math.round(245 * f);
    }
  }

  // Blit via offscreen canvas so alpha blends over waveguide background
  if (typeof document !== "undefined") {
    const off = document.createElement("canvas");
    off.width = gw;
    off.height = gh;
    const octx = off.getContext("2d");
    if (octx) {
      octx.putImageData(imgData, 0, 0);
      ctx.drawImage(off, x, y, w, h);
    }
  }
}

export function renderG2Canvas(
  canvas,
  pagePayload,
  { selectedIndex = 0, menuOpen = false, menuIndex = 0, imageBuffers = {} } = {}
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Deep optical waveguide dark substrate with subtle green micro-LED bloom
  ctx.clearRect(0, 0, G2_WIDTH, G2_HEIGHT);
  const bg = ctx.createRadialGradient(G2_WIDTH / 2, G2_HEIGHT / 2, 40, G2_WIDTH / 2, G2_HEIGHT / 2, 340);
  bg.addColorStop(0, "#05140c");
  bg.addColorStop(1, "#020604");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, G2_WIDTH, G2_HEIGHT);

  // Subtle micro-LED scanline lattice
  ctx.fillStyle = "rgba(57, 255, 156, 0.028)";
  for (let y = 0; y < G2_HEIGHT; y += 3) {
    ctx.fillRect(0, y, G2_WIDTH, 1);
  }

  if (!pagePayload) return;

  const drawItems = [];
  for (const t of pagePayload.textObject || []) {
    drawItems.push({ kind: "text", z: t.zOrderIndex || 0, obj: t });
  }
  for (const im of pagePayload.imageObject || []) {
    drawItems.push({ kind: "image", z: im.zOrderIndex || 0, obj: im });
  }
  for (const l of pagePayload.listObject || []) {
    drawItems.push({ kind: "list", z: l.zOrderIndex || 0, obj: l });
  }
  drawItems.sort((a, b) => a.z - b.z);

  ctx.textBaseline = "top";

  for (const entry of drawItems) {
    const c = entry.obj;
    const x = c.xPosition || 0;
    const y = c.yPosition || 0;
    const w = c.width || 100;
    const h = c.height || 30;
    const pad = c.paddingLength || 4;

    if (entry.kind !== "image" && c.borderWidth > 0) {
      ctx.strokeStyle = borderLevelColor(c.borderColor, 10);
      ctx.lineWidth = c.borderWidth;
      drawRoundedRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, c.borderRadius || 0);
      ctx.stroke();
    }

    if (entry.kind === "image") {
      const graphic = imageBuffers[c.containerID];
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.fillStyle = "rgba(57, 255, 156, 0.03)";
      ctx.fillRect(x, y, w, h);
      if (graphic) {
        drawGrayscaleBuffer(ctx, graphic, x, y, w, h);
      }
      ctx.restore();
    } else if (entry.kind === "text") {
      ctx.save();
      drawRoundedRect(ctx, x, y, w, h, c.borderRadius || 0);
      ctx.clip();

      const lines = String(c.content || "").split("\n");
      const isHeader = c.containerID === CONTAINER_IDS.HEADER;
      const isFooter = c.containerID === CONTAINER_IDS.FOOTER;
      const isKpi = c.containerID === CONTAINER_IDS.MARKET_KPI;

      // Authentic G2 fixed ~21px proportional font -> ~17-18px mono equivalent (strict ~38 chars/560px)
      ctx.font = isHeader
        ? "700 16px 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"
        : isFooter
          ? "500 14.5px 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"
          : isKpi
            ? "700 15px 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"
            : "500 17px 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace";

      ctx.fillStyle = textLevelColor(c.textColor, 4);
      ctx.shadowColor = "rgba(57, 255, 156, 0.35)";
      ctx.shadowBlur = isHeader || isKpi ? 5 : 2;

      const lineHeight = isHeader || isFooter || isKpi ? 20 : 30;
      const topOffset = isKpi ? Math.max(4, Math.floor((h - 16) / 2)) : pad + 4;
      lines.forEach((line, idx) => {
        ctx.fillText(line, x + pad + 4, y + topOffset + idx * lineHeight);
      });
      ctx.restore();
    } else if (entry.kind === "list") {
      ctx.save();
      drawRoundedRect(ctx, x, y, w, h, c.borderRadius || 0);
      ctx.clip();

      const items = c.itemContainer?.itemName || [];
      const rowH = 29;
      const visibleCount = Math.max(1, Math.floor((h - pad * 2) / rowH));
      const startIdx = Math.max(0, Math.min(selectedIndex - visibleCount + 1, Math.max(0, items.length - visibleCount)));

      ctx.font = "500 16px 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace";
      for (let i = 0; i < visibleCount; i++) {
        const realIdx = startIdx + i;
        if (realIdx >= items.length) break;
        const rowY = y + pad + i * rowH;
        const isSel = realIdx === selectedIndex;

        if (isSel) {
          ctx.fillStyle = "rgba(57, 255, 156, 0.17)";
          drawRoundedRect(ctx, x + pad, rowY, w - pad * 2, rowH - 3, 3);
          ctx.fill();
          ctx.strokeStyle = "#39ff9c";
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }

        ctx.fillStyle = isSel ? "#7cffbc" : textLevelColor(3);
        ctx.shadowColor = isSel ? "rgba(57, 255, 156, 0.5)" : "transparent";
        ctx.shadowBlur = isSel ? 5 : 0;
        const prefix = isSel ? "> " : "  ";
        ctx.fillText(prefix + items[realIdx], x + pad + 6, rowY + 5);
      }
      ctx.restore();
    }
  }

  // Contextual OS Action Menu overlay (mirrors MenuContainerProperty on G2)
  if (menuOpen && pagePayload.menuObject?.menuItems?.length) {
    const items = pagePayload.menuObject.menuItems;
    const mw = 250;
    const rowH = 23;
    const mh = Math.min(G2_HEIGHT - 16, 32 + items.length * rowH);
    const mx = Math.floor((G2_WIDTH - mw) / 2);
    const my = Math.floor((G2_HEIGHT - mh) / 2);

    ctx.fillStyle = "rgba(2, 10, 6, 0.96)";
    drawRoundedRect(ctx, mx, my, mw, mh, 6);
    ctx.fill();
    ctx.strokeStyle = "#39ff9c";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = "700 13px 'JetBrains Mono', Consolas, monospace";
    ctx.fillStyle = "#39ff9c";
    ctx.fillText("G2 ACTION MENU", mx + 12, my + 8);

    ctx.font = "500 13.5px 'JetBrains Mono', Consolas, monospace";
    items.forEach((item, idx) => {
      const iy = my + 27 + idx * rowH;
      const sel = idx === menuIndex;
      if (sel) {
        ctx.fillStyle = "rgba(57, 255, 156, 0.22)";
        ctx.fillRect(mx + 6, iy - 2, mw - 12, rowH - 2);
      }
      ctx.fillStyle = sel ? "#86ffc2" : "rgba(57, 255, 156, 0.72)";
      ctx.fillText((sel ? "> " : "  ") + item.itemName, mx + 12, iy + 2);
    });
  }
}
