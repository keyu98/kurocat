import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const source = 'artifacts/back-markings';
const output = 'docs/skins/orange-white-longhair';
mkdirSync(output, { recursive: true });
const dataUrl = (revision, frame) => `data:image/png;base64,${readFileSync(`${source}/${revision}/${frame}.png`).toString('base64')}`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1320, height: 1050 }, deviceScaleFactor: 1 });
  const invariants = await page.evaluate(async (images) => {
    const canvases = await Promise.all(images.map(async (src) => {
      const img = new Image(); img.src = src; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.getContext('2d');
    }));
    const result = {};
    for (const [name, x, y, width, height] of [
      ['face-and-nose-patch', 220, 85, 320, 220], ['white-ruff', 300, 325, 150, 95],
      ['white-gloves', 310, 445, 130, 90], ['orange-tail', 560, 310, 130, 140],
    ]) {
      const [a, b] = canvases.map((ctx) => ctx.getImageData(x, y, width, height).data);
      let changed = 0, maxDelta = 0;
      for (let i = 0; i < a.length; i += 4) {
        const delta = Math.max(...[0, 1, 2, 3].map((c) => Math.abs(a[i + c] - b[i + c])));
        maxDelta = Math.max(maxDelta, delta);
        if (delta > 2) changed++;
      }
      result[name] = { changedPixels: changed, totalPixels: width * height, maxChannelDelta: maxDelta };
    }
    return result;
  }, [dataUrl('before', 'front'), dataUrl('after', 'front')]);
  console.log(JSON.stringify(invariants, null, 2));
  for (const [name, result] of Object.entries(invariants)) {
    assert.ok(result.changedPixels / result.totalPixels < 0.001, `${name}: ${JSON.stringify(result)}`);
  }
  writeFileSync(`${source}/feature-comparison.json`, JSON.stringify(invariants, null, 2));
  const style = `<style>
    *{box-sizing:border-box}body{margin:0;background:#f8f6f0;color:#443429;font:16px Arial,sans-serif;padding:26px 30px}
    h1{font-size:27px;margin:0 0 8px}p{margin:0 0 18px;color:#796b5d}main{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
    figure{margin:0;background:#fff;border:1px solid #e3dbce;border-radius:12px;overflow:hidden}
    figcaption{height:42px;padding:12px 16px;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    img{display:block;width:100%;background:repeating-conic-gradient(#faf9f5 0% 25%,#f0eee8 0% 50%) 50%/20px 20px}
    footer{margin-top:15px;font-size:13px;color:#796b5d}
  </style>`;
  for (const [file, title, subtitle, frames] of [
    ['back-markings-comparison', 'Facai / back markings', 'Same model, camera and pose. Top: before (9a41d5a). Bottom: after (DEV-157).',
      [['Back', 'back-center'], ['High rear / 58 deg', 'high-back'], ['Rear side', 'side-right']]],
    ['back-markings-features', 'Facai / preserved features and poses', 'Same model, camera and pose. Top: before. Bottom: after.',
      [['Face, ruff, gloves, tail', 'front'], ['Head-pat swat / right paw', 'swat-right-front'], ['Sleep / rear side', 'sleep-side']]],
  ]) {
    const sheet = await browser.newPage({ viewport: { width: 1320, height: 1080 }, deviceScaleFactor: 1 });
    const cards = ['before', 'after'].flatMap((revision) => frames.map(([label, frame]) =>
      `<figure><figcaption>${revision.toUpperCase()} / ${label}</figcaption><img src="${dataUrl(revision, frame)}"></figure>`)).join('');
    await sheet.setContent(`${style}<h1>${title}</h1><p>${subtitle}</p><main>${cards}</main><footer>Actual WebGL runtime captures. Checkerboard is the comparison background; source PNGs have alpha.</footer>`);
    await sheet.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
    await sheet.screenshot({ path: `${output}/${file}.png`, fullPage: true });
    await sheet.close();
  }
  copyFileSync(`${source}/after/back-center.png`, `${output}/back-markings-transparent.png`);
} finally {
  await browser.close();
}
