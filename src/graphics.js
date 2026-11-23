/**
 * Zero-dependency 4-bit grayscale graphic & PNG encoder for Even Realities G2
 * `ImageContainerProperty` + `ImageRawDataUpdate` (`updateImageRawData`).
 *
 * Produces standards-compliant 8-bit grayscale PNG binary bytes (`Uint8Array`)
 * quantized to 16 shades (G2 4-bit monochrome green micro-LED scale) plus the
 * raw grayscale pixel buffer so both physical G2 glasses and the browser optical
 * simulator render pixel-identical sparklines, probability gauges, and mic meters.
 */

export const SPARK_IMG_WIDTH = 184;
export const SPARK_IMG_HEIGHT = 84;

// Precompute IEEE 802.3 CRC-32 table for valid PNG chunks
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function writeU32BE(arr, offset, val) {
  arr[offset] = (val >>> 24) & 0xff;
  arr[offset + 1] = (val >>> 16) & 0xff;
  arr[offset + 2] = (val >>> 8) & 0xff;
  arr[offset + 3] = val & 0xff;
}

function makePngChunk(typeStr, data) {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = typeStr.charCodeAt(i);
  const chunk = new Uint8Array(12 + data.length);
  writeU32BE(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  writeU32BE(chunk, 8 + data.length, crc);
  return chunk;
}

/**
 * Encode an 8-bit grayscale pixel buffer (width * height) into a valid PNG Uint8Array.
 * Uses zlib stored DEFLATE blocks (zero external deps, deterministic, fast in Node & WebView).
 */
export function encodeGrayscalePng(pixels, width, height) {
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  if (pixels.length < w * h) {
    throw new Error(`Pixel buffer too small: expected ${w * h}, got ${pixels.length}`);
  }

  // Raw scanlines: 1 filter byte (0 = None) + w grayscale bytes per row
  const stride = w + 1;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    const rowStart = y * w;
    for (let x = 0; x < w; x++) {
      // Quantize cleanly to G2 4-bit (16-shade) grayscale
      const q = (pixels[rowStart + x] >> 4) * 17;
      raw[y * stride + 1 + x] = q;
    }
  }

  // Wrap raw scanlines in valid zlib stream using uncompressed DEFLATE blocks (<= 65535 bytes each)
  const maxBlock = 65535;
  const blockCount = Math.ceil(raw.length / maxBlock);
  const zlibBuf = new Uint8Array(2 + raw.length + blockCount * 5 + 4);
  zlibBuf[0] = 0x78; // CMF: deflate, 32K window
  zlibBuf[1] = 0x01; // FLG: no dict, check bits (0x7801 % 31 === 0)
  let outPos = 2;
  let inPos = 0;
  while (inPos < raw.length) {
    const len = Math.min(maxBlock, raw.length - inPos);
    const isFinal = inPos + len >= raw.length ? 1 : 0;
    zlibBuf[outPos++] = isFinal; // BFINAL | BTYPE=00 (stored)
    zlibBuf[outPos++] = len & 0xff;
    zlibBuf[outPos++] = (len >>> 8) & 0xff;
    const nlen = (~len) & 0xffff;
    zlibBuf[outPos++] = nlen & 0xff;
    zlibBuf[outPos++] = (nlen >>> 8) & 0xff;
    zlibBuf.set(raw.subarray(inPos, inPos + len), outPos);
    outPos += len;
    inPos += len;
  }
  writeU32BE(zlibBuf, outPos, adler32(raw));

  // IHDR: width, height, bitDepth=8, colorType=0 (grayscale), compression=0, filter=0, interlace=0
  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, w);
  writeU32BE(ihdr, 4, h);
  ihdr[8] = 8;
  ihdr[9] = 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makePngChunk("IHDR", ihdr);
  const idatChunk = makePngChunk("IDAT", zlibBuf);
  const iendChunk = makePngChunk("IEND", new Uint8Array(0));

  const png = new Uint8Array(sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  let pos = 0;
  png.set(sig, pos); pos += sig.length;
  png.set(ihdrChunk, pos); pos += ihdrChunk.length;
  png.set(idatChunk, pos); pos += idatChunk.length;
  png.set(iendChunk, pos);
  return png;
}

function setPx(buf, w, h, x, y, val) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= w || iy < 0 || iy >= h) return;
  const idx = iy * w + ix;
  if (val > buf[idx]) buf[idx] = val;
}

function drawRectFrame(buf, w, h, gray = 110) {
  for (let x = 0; x < w; x++) {
    setPx(buf, w, h, x, 0, gray);
    setPx(buf, w, h, x, h - 1, gray);
  }
  for (let y = 0; y < h; y++) {
    setPx(buf, w, h, 0, y, gray);
    setPx(buf, w, h, w - 1, y, gray);
  }
}

function drawThickLine(buf, w, h, x0, y0, x1, y1, val = 255) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 1.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x0 + dx * t;
    const py = y0 + dy * t;
    setPx(buf, w, h, px, py, val);
    setPx(buf, w, h, px, py + 1, Math.round(val * 0.85));
  }
}

function drawFilledCircle(buf, w, h, cx, cy, r, val = 255) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) {
        setPx(buf, w, h, cx + dx, cy + dy, val);
      }
    }
  }
}

// Tiny 3x5 bitmap glyphs for ultra-crisp micro-labels inside graphics
const MINI_FONT = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "A": ["010", "101", "111", "101", "101"],
  "B": ["110", "101", "110", "101", "110"],
  "C": ["111", "100", "100", "100", "111"],
  "D": ["110", "101", "101", "101", "110"],
  "E": ["111", "100", "110", "100", "111"],
  "F": ["111", "100", "110", "100", "100"],
  "G": ["111", "100", "101", "101", "111"],
  "H": ["101", "101", "111", "101", "101"],
  "I": ["111", "010", "010", "010", "111"],
  "J": ["001", "001", "001", "101", "111"],
  "K": ["101", "101", "110", "101", "101"],
  "L": ["100", "100", "100", "100", "111"],
  "M": ["101", "111", "101", "101", "101"],
  "N": ["111", "101", "101", "101", "101"],
  "O": ["111", "101", "101", "101", "111"],
  "P": ["111", "101", "111", "100", "100"],
  "Q": ["111", "101", "101", "111", "001"],
  "R": ["110", "101", "110", "101", "101"],
  "S": ["111", "100", "111", "001", "111"],
  "T": ["111", "010", "010", "010", "010"],
  "U": ["101", "101", "101", "101", "111"],
  "V": ["101", "101", "101", "101", "010"],
  "W": ["101", "101", "101", "111", "101"],
  "X": ["101", "101", "010", "101", "101"],
  "Y": ["101", "101", "010", "010", "010"],
  "Z": ["111", "001", "010", "100", "111"],
  "%": ["101", "001", "010", "100", "101"],
  "+": ["000", "010", "111", "010", "000"],
  "-": ["000", "000", "111", "000", "000"],
  ".": ["000", "000", "000", "000", "010"],
  ":": ["000", "010", "000", "010", "000"],
  " ": ["000", "000", "000", "000", "000"],
};

function drawMiniText(buf, w, h, text, x0, y0, scale = 1, val = 220) {
  const str = String(text || "").toUpperCase();
  let cx = x0;
  for (const ch of str) {
    const glyph = MINI_FONT[ch] || MINI_FONT[" "];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        if (glyph[r][c] === "1") {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              setPx(buf, w, h, cx + c * scale + sx, y0 + r * scale + sy, val);
            }
          }
        }
      }
    }
    cx += 4 * scale;
  }
}

/**
 * Render a 4-bit grayscale 24h price sparkline chart for G2 `updateImageRawData`.
 */
export function renderSparklineImage(
  points,
  { width = SPARK_IMG_WIDTH, height = SPARK_IMG_HEIGHT, tag = "24H", deltaText = "" } = {}
) {
  const buf = new Uint8Array(width * height);
  drawRectFrame(buf, width, hOr(height), 119);

  // Subtle horizontal reference lines
  const padL = 8;
  const padR = 8;
  const padT = 18;
  const padB = 10;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  for (let x = padL; x < width - padR; x += 4) {
    setPx(buf, width, height, x, padT + Math.floor(plotH / 2), 68);
  }

  // Micro-header inside chart
  drawMiniText(buf, width, height, tag, 6, 5, 1, 204);
  if (deltaText) {
    const dStr = String(deltaText).toUpperCase().slice(0, 9);
    const dx = Math.max(54, width - 6 - dStr.length * 4);
    drawMiniText(buf, width, height, dStr, dx, 5, 1, 255);
  }

  const nums = (Array.isArray(points) ? points : []).map(Number).filter(Number.isFinite);
  if (nums.length >= 2) {
    let minV = Math.min(...nums);
    let maxV = Math.max(...nums);
    if (maxV - minV < 1e-9) {
      minV -= 1;
      maxV += 1;
    }

    const coords = nums.map((v, i) => ({
      x: padL + (i / (nums.length - 1)) * plotW,
      y: padT + (1 - (v - minV) / (maxV - minV)) * plotH,
    }));

    // 4-bit shaded area under the curve
    const baseY = padT + plotH;
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const xStart = Math.max(padL, Math.floor(a.x));
      const xEnd = Math.min(width - padR, Math.ceil(b.x));
      for (let x = xStart; x <= xEnd; x++) {
        const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
        const yCurve = a.y + (b.y - a.y) * t;
        for (let y = Math.ceil(yCurve) + 1; y <= baseY; y++) {
          const frac = 1 - (y - yCurve) / Math.max(1, baseY - yCurve);
          const shade = Math.round(34 + frac * 51); // 4-bit gentle luminance gradient
          setPx(buf, width, height, x, y, shade);
        }
      }
    }

    // High-contrast 2px sparkline stroke
    for (let i = 0; i < coords.length - 1; i++) {
      drawThickLine(buf, width, height, coords[i].x, coords[i].y, coords[i + 1].x, coords[i + 1].y, 255);
    }

    // Endpoint glow dot
    const last = coords[coords.length - 1];
    drawFilledCircle(buf, width, height, Math.round(last.x), Math.round(last.y), 2, 255);
  }

  return {
    kind: "sparkline",
    width,
    height,
    pixels: buf,
    pngBytes: encodeGrayscalePng(buf, width, height),
  };
}

function hOr(h) {
  return h;
}

/**
 * Render a 4-bit grayscale Polymarket YES/NO probability gauge bar.
 */
export function renderProbabilityBarImage(
  yesPct,
  { width = SPARK_IMG_WIDTH, height = SPARK_IMG_HEIGHT, deltaText = "" } = {}
) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(yesPct) || 0)));
  const buf = new Uint8Array(width * height);
  drawRectFrame(buf, width, height, 119);

  drawMiniText(buf, width, height, `YES ${pct}%`, 8, 8, 2, 255);
  if (deltaText) {
    const dStr = String(deltaText).toUpperCase().slice(0, 8);
    drawMiniText(buf, width, height, dStr, Math.max(96, width - 8 - dStr.length * 4), 10, 1, 204);
  }

  // Gauge frame
  const bx = 10;
  const by = 34;
  const bw = width - 20;
  const bh = 22;
  for (let x = bx; x < bx + bw; x++) {
    setPx(buf, width, height, x, by, 170);
    setPx(buf, width, height, x, by + bh - 1, 170);
  }
  for (let y = by; y < by + bh; y++) {
    setPx(buf, width, height, bx, y, 170);
    setPx(buf, width, height, bx + bw - 1, y, 170);
  }

  // Segmented luminance fill for YES probability
  const fillW = Math.round(((bw - 4) * pct) / 100);
  for (let x = 0; x < fillW; x++) {
    const stripe = (x % 6) < 4 ? 238 : 170;
    for (let y = by + 2; y < by + bh - 2; y++) {
      setPx(buf, width, height, bx + 2 + x, y, stripe);
    }
  }

  // 50% midpoint reference marker
  const midX = bx + Math.floor(bw / 2);
  for (let y = by - 4; y < by + bh + 4; y++) {
    setPx(buf, width, height, midX, y, 255);
  }

  // Footer labels
  drawMiniText(buf, width, height, "0%", 10, 66, 1, 136);
  drawMiniText(buf, width, height, "50%", midX - 6, 66, 1, 170);
  drawMiniText(buf, width, height, `NO ${100 - pct}%`, width - 48, 66, 1, 170);

  return {
    kind: "probability",
    width,
    height,
    pixels: buf,
    pngBytes: encodeGrayscalePng(buf, width, height),
  };
}

/**
 * Render a 4-bit grayscale 16-bar live microphone waveform / voice-activity graphic.
 */
export function renderMicWaveformImage(
  levels,
  { width = SPARK_IMG_WIDTH, height = SPARK_IMG_HEIGHT, active = false, roleLabel = "MIC READY" } = {}
) {
  const buf = new Uint8Array(width * height);
  drawRectFrame(buf, width, height, active ? 221 : 119);

  drawMiniText(buf, width, height, active ? "REC G2 MIC" : "VOICE READY", 8, 6, 1, active ? 255 : 187);
  const rStr = String(roleLabel || "").toUpperCase().slice(0, 10);
  drawMiniText(buf, width, height, rStr, Math.max(88, width - 8 - rStr.length * 4), 6, 1, 204);

  const bars = 16;
  const arr = Array.isArray(levels) && levels.length ? levels : new Array(bars).fill(0.08);
  const centerY = 48;
  const maxHalfH = 24;
  const barW = 6;
  const gap = 4;
  const totalW = bars * barW + (bars - 1) * gap;
  const startX = Math.floor((width - totalW) / 2);

  for (let i = 0; i < bars; i++) {
    const raw = arr[i % arr.length];
    const norm = Math.max(0.08, Math.min(1, Number(raw) || 0.08));
    const halfH = Math.max(2, Math.round(norm * maxHalfH));
    const bx = startX + i * (barW + gap);
    const val = active ? (norm > 0.45 ? 255 : 187) : 119;
    for (let x = bx; x < bx + barW; x++) {
      for (let y = centerY - halfH; y <= centerY + halfH; y++) {
        setPx(buf, width, height, x, y, val);
      }
    }
  }

  return {
    kind: "waveform",
    width,
    height,
    pixels: buf,
    pngBytes: encodeGrayscalePng(buf, width, height),
  };
}
