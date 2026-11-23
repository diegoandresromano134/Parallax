// Genera los íconos PNG (Android/iPhone) a partir de public/icons/icon.svg
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';
const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const b = await chromium.launch(); const p = await b.newPage();
for (const [size, name] of [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-icon.png']]) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await p.screenshot({ path: new URL(`../public/icons/${name}`, import.meta.url).pathname });
}
await b.close();
