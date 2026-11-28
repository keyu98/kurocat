import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
const outputDir = "artifacts/head-pat-swat";
mkdirSync(outputDir, { recursive: true });
const capture = process.argv.includes("--capture");
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1456"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let browser;
try {
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (d) => {
      if (d.toString().includes("Local:")) resolve();
    });
    server.on("error", reject);
    server.on("exit", (code) => reject(Error("Vite exited " + code)));
    setTimeout(() => reject(Error("Vite startup timeout")), 15000).unref();
  });
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 420, height: 440 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/swat-test", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<body style="margin:0;background:transparent"><canvas id="cat" style="width:420px;height:440px"></canvas></body>',
    }),
  );
  await page.goto("http://127.0.0.1:1456/swat-test");
  await page.evaluate(async () => {
    const { KuroCatEngine } = await import("/src/catEngine.ts");
    const { ORANGE_WHITE_LONGHAIR } = await import("/src/catSkins.ts");
    window.skin = ORANGE_WHITE_LONGHAIR;
    window.e = new KuroCatEngine(document.getElementById("cat"));
    e.setCatAppearance(skin.id, skin);
    e.setHeadPatSwatChance(1);
    e.resize();
    e.update(0.016, performance.now());
    e.render();
    window.rub2 = (y = 140, over = true) => {
      for (const x of [175, 195, 215, 195, 175, 195, 215])
        e.onWindowCursor(x / 420, y / 440, over);
      return e.headPatSwat.isActive(performance.now());
    };
  });
  await page.waitForFunction(
    () => window.e.swatPaws?.complete && e.swatPaws.naturalWidth > 0,
  );
  const checks = {};
  checks.twoD = await page.evaluate(() => {
    const out = {};
    out.bellyDoesNotSwat = !rub2(240);
    e.headPatSwat.resetGesture();
    out.headSwats = rub2();
    out.purrSuppressed = e.petEnergy === 0 && e.squintAmount === 0;
    e.update(0.016, performance.now());
    e.render();
    const ctx = e.canvas.getContext("2d");
    out.transparentCorner = ctx.getImageData(0, 0, 1, 1).data[3] === 0;
    e.setPrivacyMode(true);
    out.privacyCancels = !e.headPatSwat.isActive(performance.now());
    out.privacyNoSwat = !rub2();
    e.setPrivacyMode(false);
    e.headPatSwat.rolledAt = -Infinity;
    e.setHeadPatSwatChance(0);
    out.disabled = !rub2();
    out.normalPettingPreserved = e.petEnergy > 0;
    e.headPatSwat.resetGesture();
    e.setHeadPatSwatChance(1);
    e.headPatSwat.rolledAt = -Infinity;
    out.reenabled = rub2();
    e.headPatSwat.startedAt = performance.now() - 1000;
    e.update(0.016, performance.now());
    out.completes = e.headPatSwat.pose(performance.now()) === null;
    e.headPatSwat.resetGesture();
    e.headPatSwat.rolledAt = -Infinity;
    e.setCatAppearance("black");
    out.blackCatSwats = rub2();
    e.headPatSwat.cancel();
    e.headPatSwat.rolledAt = -Infinity;
    e.setCatAppearance("dafeiyu");
    out.whaleExcluded = !rub2();
    e.setCatAppearance(skin.id, skin);
    // Full-size keyboard + small render scale: head coordinates must use the viewport transform.
    e.headPatSwat.rolledAt = -Infinity;
    e.setKeyboardConfig("108", "cat");
    e.setRenderScale(0.6);
    const v = e.getViewportTransform(),
      h = e.spinePoint(0.24, 0);
    for (const dx of [-20, 0, 20, 0, -20, 0, 20])
      e.onWindowCursor(
        (v.offsetX + (h.x + dx) * v.uniformScale) / e.canvas.width,
        (v.offsetY + h.y * v.uniformScale) / e.canvas.height,
        true,
      );
    out.scaledFullKeyboardHead = e.headPatSwat.isActive(performance.now());
    e.headPatSwat.cancel();
    e.setKeyboardConfig("65", "cat");
    e.setRenderScale(1);
    return out;
  });
  for (const [key, value] of Object.entries(checks.twoD))
    assert.equal(value, true, `2D ${key}`);
  await page.evaluate(() => {
    e.headPatSwat.rolledAt = -Infinity;
    e.headPatSwat.resetGesture();
    rub2();
  });
  if (capture)
    for (let i = 0; i < 30; i++) {
      await page.evaluate((t) => {
        e.headPatSwat.startedAt = performance.now() - t;
        e.update(0.016, performance.now());
        e.render();
      }, i * 32);
      await page.screenshot({
        path: `${outputDir}/2d-${String(i).padStart(2, "0")}.png`,
        omitBackground: true,
      });
    }
  await page.evaluate(async () => {
    e.stop();
    document
      .getElementById("cat")
      .replaceWith(document.createElement("canvas"));
    document.querySelector("canvas").id = "cat";
    document.querySelector("canvas").style.cssText = "width:420px;height:440px";
    const { KuroCatEngine3D } = await import("/src/catEngine3d.ts");
    window.g = new KuroCatEngine3D(document.getElementById("cat"), {
      embedded: false,
    });
    g.setCatSkin(skin);
    g.setHeadPatSwatChance(1);
    g.resize();
    g.update(0.016);
    g.renderer.render(g.scene, g.camera);
    window.headLine = () => {
      const rows = [];
      for (let y = 0.18; y < 0.6; y += 0.025) {
        const xs = [];
        for (let x = 0.25; x < 0.7; x += 0.025) {
          g.cursorNdc.set(x * 2 - 1, 1 - y * 2);
          if (g.isCursorOverHead()) xs.push(x);
        }
        if (xs.length >= 4) rows.push({ y, xs });
      }
      if (!rows.length) throw Error("No head raycast row");
      return rows[Math.floor(rows.length / 2)];
    };
    window.rub3 = () => {
      const { y, xs } = headLine();
      const a = xs[0],
        b = xs[xs.length - 1],
        m = (a + b) / 2;
      for (const x of [a, m, b, m, a, m, b]) {
        g.elapsed += 0.02;
        g.onWindowCursor(x, y, true);
      }
      return g.headPatSwat.isActive(g.elapsed * 1000);
    };
  });
  checks.threeD = await page.evaluate(() => {
    const out = {};
    out.headSwats = rub3();
    out.purrSuppressed = !g.petting;
    g.update(0.016);
    const raised = g.paws.R.pos.clone();
    g.headPatSwat.startedAt = g.elapsed * 1000 - 350;
    g.update(0.016);
    out.pawMoves = g.paws.R.pos.distanceTo(raised) > 0.3;
    out.alphaRenderer = g.renderer.getContext().getContextAttributes().alpha;
    g.setPrivacyMode(true);
    out.privacyCancels = !g.headPatSwat.isActive(g.elapsed * 1000);
    g.headPatSwat.rolledAt = -Infinity;
    out.privacyNoSwat = !rub3();
    g.setPrivacyMode(false);
    g.headPatSwat.resetGesture();
    g.setHeadPatSwatChance(0);
    out.disabled = !rub3();
    g.headPatSwat.rolledAt = -Infinity;
    g.setHeadPatSwatChance(1);
    out.reenabled = rub3();
    g.headPatSwat.startedAt = g.elapsed * 1000 - 1000;
    g.update(0.016);
    out.completes = g.headPatSwat.pose(g.elapsed * 1000) === null;
    g.headPatSwat.cancel();
    g.headPatSwat.rolledAt = -Infinity;
    const { y, xs } = headLine(),
      a = xs[0],
      b = xs[xs.length - 1],
      m = (a + b) / 2;
    for (const x of [a, m, b, m, a, m, b]) {
      g.elapsed += 0.02;
      g.onPointerMove(x * 420, y * 440, true, true);
    }
    out.browserPointerSwats = g.headPatSwat.isActive(g.elapsed * 1000);
    g.headPatSwat.cancel();
    g.headPatSwat.rolledAt = -Infinity;
    for (const x of [0.4, 0.45, 0.5, 0.45, 0.4, 0.45, 0.5]) {
      g.elapsed += 0.02;
      g.onWindowCursor(x, 0.64, true);
    }
    out.bellyDoesNotSwat = !g.headPatSwat.isActive(g.elapsed * 1000);
    return out;
  });
  for (const [key, value] of Object.entries(checks.threeD))
    assert.equal(value, true, `3D ${key}`);
  await page.evaluate(() => {
    g.headPatSwat.rolledAt = -Infinity;
    g.headPatSwat.resetGesture();
    rub3();
  });
  if (capture)
    for (let i = 0; i < 30; i++) {
      await page.evaluate((t) => {
        g.headPatSwat.startedAt = g.elapsed * 1000 - t;
        g.update(0.016);
        g.renderer.render(g.scene, g.camera);
      }, i * 32);
      await page.screenshot({
        path: `${outputDir}/3d-${String(i).padStart(2, "0")}.png`,
        omitBackground: true,
      });
    }
  checks.errors = errors;
  assert.deepEqual(errors, []);
  writeFileSync(
    `${outputDir}/browser-results.json`,
    JSON.stringify(checks, null, 2),
  );
  console.log(JSON.stringify(checks, null, 2));
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
}
