// Genera las imágenes de marca del instalador NSIS en el estilo de la app
// (degradado índigo oscuro + brillo + logo + nombre). Salida en build/*.bmp.
// Uso: node build-hooks/make-installer-images.js
const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');

// Escribe un BMP de 24 bits BOTTOM-UP (formato clásico que NSIS/GDI espera).
// jimp escribiría top-down (altura negativa), que algunos NSIS no renderizan.
function writeBMP24(img, outPath) {
  const { width: w, height: h, data } = img.bitmap; // data = RGBA top-down
  const rowSize = Math.floor((24 * w + 31) / 32) * 4; // filas alineadas a 4 bytes
  const imgSize = rowSize * h;
  const buf = Buffer.alloc(54 + imgSize, 0);
  buf.write('BM', 0);
  buf.writeUInt32LE(54 + imgSize, 2);
  buf.writeUInt32LE(54, 10);              // offset a los datos
  buf.writeUInt32LE(40, 14);              // tamaño BITMAPINFOHEADER
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);                // POSITIVO = bottom-up
  buf.writeUInt16LE(1, 26);               // planes
  buf.writeUInt16LE(24, 28);              // bpp
  buf.writeUInt32LE(imgSize, 34);
  buf.writeInt32LE(2835, 38);             // 72 DPI
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) {
    const srcY = y;                       // RGBA top-down
    const dstY = h - 1 - y;               // BMP bottom-up
    let off = 54 + dstY * rowSize;
    for (let x = 0; x < w; x++) {
      const s = (srcY * w + x) * 4;
      buf[off++] = data[s + 2]; // B
      buf[off++] = data[s + 1]; // G
      buf[off++] = data[s];     // R
    }
  }
  fs.writeFileSync(outPath, buf);
}

const ICON = path.join(__dirname, '..', 'assets', 'icon.png');
const OUT = path.join(__dirname, '..', 'build');

// Paleta app
const TOP = [23, 21, 46];    // #17152e
const BOT = [8, 8, 15];      // #08080f
const INDIGO = [99, 102, 241]; // #6366f1

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

// Rellena img con degradado vertical + brillo índigo radial centrado en (gx,gy)
function paintBackground(img, gx, gy, glowR, glowStrength) {
  const { width: w, height: h, data } = img.bitmap;
  for (let y = 0; y < h; y++) {
    const ty = y / (h - 1);
    const r0 = lerp(TOP[0], BOT[0], ty);
    const g0 = lerp(TOP[1], BOT[1], ty);
    const b0 = lerp(TOP[2], BOT[2], ty);
    for (let x = 0; x < w; x++) {
      const dx = x - gx, dy = y - gy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const glow = Math.max(0, 1 - d / glowR) * glowStrength;
      const idx = (y * w + x) * 4;
      data[idx] = Math.min(255, r0 + INDIGO[0] * glow);
      data[idx + 1] = Math.min(255, g0 + INDIGO[1] * glow);
      data[idx + 2] = Math.min(255, b0 + INDIGO[2] * glow);
      data[idx + 3] = 255; // opaco -> BMP de 24 bits
    }
  }
}

// Aro de brillo índigo suave detrás del logo
function paintRing(img, cx, cy, radius, thickness, strength) {
  const { width: w, height: h, data } = img.bitmap;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const k = Math.max(0, 1 - Math.abs(d - radius) / thickness) * strength;
      if (k <= 0) continue;
      const idx = (y * w + x) * 4;
      data[idx] = Math.min(255, data[idx] + INDIGO[0] * k);
      data[idx + 1] = Math.min(255, data[idx + 1] + INDIGO[1] * k);
      data[idx + 2] = Math.min(255, data[idx + 2] + INDIGO[2] * k);
    }
  }
}

async function main() {
  const logo = await Jimp.read(ICON);
  const fontBig = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
  const fontSmall = await Jimp.loadFont(Jimp.FONT_SANS_8_WHITE);

  // ── Sidebar 164x314 (páginas de bienvenida / fin) ──
  const sb = new Jimp(164, 314, 0x000000ff);
  paintBackground(sb, 82, 118, 150, 0.55);
  paintRing(sb, 82, 118, 62, 10, 0.5);
  const logoS = logo.clone().resize(96, 96);
  sb.composite(logoS, 82 - 48, 118 - 48);
  // Nombre centrado bajo el logo
  const name = 'imputa.me';
  const nameW = Jimp.measureText(fontBig, name);
  sb.print(fontBig, Math.round((164 - nameW) / 2), 196, name);
  const tag = 'Registra tus horas';
  const tagW = Jimp.measureText(fontSmall, tag);
  sb.print(fontSmall, Math.round((164 - tagW) / 2), 222, tag);
  writeBMP24(sb, path.join(OUT, 'installerSidebar.bmp'));
  writeBMP24(sb, path.join(OUT, 'uninstallerSidebar.bmp'));

  // ── Header 150x57 (banner superior de páginas internas) ──
  const hd = new Jimp(150, 57, 0x000000ff);
  paintBackground(hd, 26, 28, 90, 0.5);
  const logoH = logo.clone().resize(38, 38);
  hd.composite(logoH, 8, 10);
  hd.print(fontBig, 52, 12, 'imputa');
  hd.print(fontSmall, 52, 34, '.me');
  writeBMP24(hd, path.join(OUT, 'installerHeader.bmp'));

  console.log('OK -> build/installerSidebar.bmp, uninstallerSidebar.bmp, installerHeader.bmp');
}

main().catch((e) => { console.error(e); process.exit(1); });
