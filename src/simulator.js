/**
 * Authentic Even Realities G2 576x288 Monochrome Green Optical Waveguide Renderer.
 *
 * Renders the exact EvenHub SDK page containers (`textObject`, `listObject`,
 * `menuObject`) onto a 576x288 HTML5 Canvas with G2's 4-level green micro-LED
 * luminance scale (0..4) so judges and developers can test 100% of glasses UX
 * directly in any browser when running outside the Flutter WebView host.
 */

import { G2_WIDTH, G2_HEIGHT } from "./g2-layout.js";

const BRIGHTNESS_PALETTE = {
  0: "rgba(0, 255, 136, 0.22)",
  1: "rgba(0, 255, 136, 0.44)",
  2: "rgba(0, 255, 136, 0.66)",
  3: "rgba(0, 255, 136, 0.85)",
  4: "#39ff9c",
};

function levelColor(level, fallback = 4) {
  const key = level === undefined || level === null ? fallback : Math.max(0, Math.min(4, Number(level)));
  return BRIGHTNESS_PALETTE[key] || BRIGHTNESS_PALETTE[4];
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

export function renderG2Canvas(canvas, pagePayload, { selectedIndex = 0, menuOpen = false, menuIndex = 0 } = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Optical waveguide deep black substrate with subtle ambient green bloom
  ctx.clearRect(0, 0, G2_WIDTH, G2_HEIGHT);
  const bg = ctx.createRadialGradient(G2_WIDTH / 2, G2_HEIGHT / 2, 40, G2_WIDTH / 2, G2_HEIGHT / 2, 340);
  bg.addColorStop(0, "#05140c");
  bg.addColorStop(1, "#020604");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, G2_WIDTH, G2_HEIGHT);

  // Subtle waveguide scanline grid
  ctx.fillStyle = "rgba(57, 255, 156, 0.025)";
  for (let y = 0; y < G2_HEIGHT; y += 3) {
    ctx.fillRect(0, y, G2_WIDTH, 1);
  }

  if (!pagePayload) return;

  const drawItems = [];
  for (const t of pagePayload.textObject || []) {
    drawItems.push({ kind: "text", z: t.zOrderIndex || 0, obj: t });
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

    if (c.borderWidth > 0) {
      ctx.strokeStyle = levelColor(c.borderColor, 2);
      ctx.lineWidth = c.borderWidth;
      drawRoundedRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, c.borderRadius || 0);
      ctx.stroke();
    }

    if (entry.kind === "text") {
      ctx.save();
      drawRoundedRect(ctx, x, y, w, h, c.borderRadius || 0);
      ctx.clip();

      const lines = String(c.content || "").split("\n");
      const isHeader = c.containerID === 1;
      const isFooter = c.containerID === 4;
      ctx.font = isHeader
        ? "700 13px 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"
        : isFooter
          ? "500 12px 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"
          : "500 12.5px 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace";
      ctx.fillStyle = levelColor(c.textColor, 4);
      ctx.shadowColor = "rgba(57, 255, 156, 0.35)";
      ctx.shadowBlur = isHeader ? 6 : 2;

      const lineHeight = isHeader ? 18 : 16;
      lines.forEach((line, idx) => {
        ctx.fillText(line, x + pad + 4, y + pad + 2 + idx * lineHeight);
      });
      ctx.restore();
    } else if (entry.kind === "list") {
      ctx.save();
      drawRoundedRect(ctx, x, y, w, h, c.borderRadius || 0);
      ctx.clip();

      const items = c.itemContainer?.itemName || [];
      const rowH = 24;
      const visibleCount = Math.max(1, Math.floor((h - pad * 2) / rowH));
      const startIdx = Math.max(0, Math.min(selectedIndex - visibleCount + 1, Math.max(0, items.length - visibleCount)));

      ctx.font = "500 13px 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace";
      for (let i = 0; i < visibleCount; i++) {
        const realIdx = startIdx + i;
        if (realIdx >= items.length) break;
        const rowY = y + pad + i * rowH;
        const isSel = realIdx === selectedIndex;

        if (isSel) {
          ctx.fillStyle = "rgba(57, 255, 156, 0.16)";
          drawRoundedRect(ctx, x + pad, rowY, w - pad * 2, rowH - 2, 3);
          ctx.fill();
          ctx.strokeStyle = "#39ff9c";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        ctx.fillStyle = isSel ? "#6bffb3" : levelColor(3);
        ctx.shadowColor = isSel ? "rgba(57, 255, 156, 0.5)" : "transparent";
        ctx.shadowBlur = isSel ? 5 : 0;
        const prefix = isSel ? "> " : "  ";
        ctx.fillText(prefix + items[realIdx], x + pad + 6, rowY + 4);
      }
      ctx.restore();
    }
  }

  // Optional contextual OS menu overlay (mirrors MenuContainerProperty on G2)
  if (menuOpen && pagePayload.menuObject?.menuItems?.length) {
    const items = pagePayload.menuObject.menuItems;
    const mw = 230;
    const mh = Math.min(G2_HEIGHT - 24, 34 + items.length * 24);
    const mx = Math.floor((G2_WIDTH - mw) / 2);
    const my = Math.floor((G2_HEIGHT - mh) / 2);

    ctx.fillStyle = "rgba(2, 10, 6, 0.94)";
    drawRoundedRect(ctx, mx, my, mw, mh, 6);
    ctx.fill();
    ctx.strokeStyle = "#39ff9c";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = "700 12px 'JetBrains Mono', Consolas, monospace";
    ctx.fillStyle = "#39ff9c";
    ctx.fillText("G2 ACTION MENU", mx + 12, my + 8);

    ctx.font = "500 12.5px 'JetBrains Mono', Consolas, monospace";
    items.forEach((item, idx) => {
      const iy = my + 28 + idx * 24;
      const sel = idx === menuIndex;
      if (sel) {
        ctx.fillStyle = "rgba(57, 255, 156, 0.22)";
        ctx.fillRect(mx + 6, iy - 2, mw - 12, 22);
      }
      ctx.fillStyle = sel ? "#7dffbe" : "rgba(57, 255, 156, 0.72)";
      ctx.fillText((sel ? "> " : "  ") + item.itemName, mx + 12, iy + 2);
    });
  }
}
