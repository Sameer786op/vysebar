// Renders VyseBar's mark (the same drawing as VyseLogo in components/icons.tsx) into
// build/icon.png and a multi-size build/icon.ico for the installer and the exe.
// Run with `npm run icons`: it needs Electron to rasterise the SVG.
import { app, BrowserWindow, nativeImage } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const out = join(resolve(import.meta.dirname, ".."), "build");
const SIZE = 512;
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7cc4ff"/>
      <stop offset="0.5" stop-color="#8b7bff"/>
      <stop offset="1" stop-color="#ff6fb5"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#g)"/>
  <path d="M9 10.5 L16 22.5 L23 10.5" fill="none" stroke="white" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="8" y="24.6" width="16" height="2.2" rx="1.1" fill="white" opacity="0.85"/>
</svg>`;

const html = `<!doctype html><html><style>html,body{margin:0;overflow:hidden;background:transparent}svg{display:block}</style><body>${svg}</body></html>`;

// an .ico is a small directory followed by one PNG per size
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  win.webContents.setFrameRate(1);
  const painted = new Promise((done) => win.webContents.once("paint", (_e, _dirty, image) => done(image)));
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const full = await painted;
  const base = nativeImage.createFromBuffer(full.toPNG()).resize({ width: SIZE, height: SIZE, quality: "best" });

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "icon.png"), base.toPNG());
  const pngs = ICO_SIZES.map((size) => ({ size, data: base.resize({ width: size, height: size, quality: "best" }).toPNG() }));
  writeFileSync(join(out, "icon.ico"), ico(pngs));
  console.log(`make-icons: wrote ${join(out, "icon.png")} and icon.ico (${ICO_SIZES.join(", ")})`);
  app.quit();
});
