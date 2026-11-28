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
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.route("**/swat-test", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<body style="margin:0;background:transparent"><canvas id="cat" style="width:420px;height:440px"></canvas></body>',
    }),
  );
  await page.goto("http://127.0.0.1:1456/swat-test");
  const checks = {};
  await page.evaluate(async () => {
    const { ORANGE_WHITE_LONGHAIR, resolveCatRenderMode } =
      await import("/src/catSkins.ts");
    window.skin = ORANGE_WHITE_LONGHAIR;
    window.resolveCatRenderMode = resolveCatRenderMode;
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
    out.legacyFacai2dBecomes3d = resolveCatRenderMode(skin.id, "2d") === "3d";
    out.otherCatsKeep2d = resolveCatRenderMode("black", "2d") === "2d";
    out.headSwats = rub3();
    out.purrSuppressed = !g.petting;
    g.update(0.016);
    const raised = g.paws.R.pos.clone();
    g.headPatSwat.startedAt = g.elapsed * 1000 - 180;
    g.update(0.016);
    out.pawMoves = g.paws.R.pos.distanceTo(raised) > 0.3;
    out.angryEyes = g.longhairModel.eyes.every(
      (eye) => eye.uniforms.uAnger.value > 0.9,
    );
    out.airplaneEars = g.ears.every(
      (ear) => Math.abs(ear.group.rotation.z) > ear.tilt,
    );
    out.angerMark = g.angerSprite.visible;
    out.palmPadsVisible =
      g.swatPalm.visible && g.swatToes.length === 4 &&
      g.swatToes.every((toe) => toe.children[1].material === g.swatPadMat);
    const windupCurl = g.swatToes[0].rotation.x;
    const normal = new g.camera.position.constructor(0, 0, 1).applyQuaternion(
      g.swatPalm.quaternion,
    );
    const towardViewer = g.camera.position
      .clone()
      .sub(g.swatPalm.position)
      .normalize();
    out.palmFacesViewer = normal.dot(towardViewer) > 0.9;
    out.noPrintBeforeContact = !g.pawPrint.sprite.visible;
    g.headPatSwat.startedAt = g.elapsed * 1000 - 410;
    g.update(0.016);
    out.fistClosesOnContact = g.swatToes.every((toe) => toe.rotation.x > windupCurl + 0.5);
    out.contactLeavesPrint = g.pawPrint.sprite.visible && g.pawPrint.stampedAt === g.elapsed;
    out.fistVisibleBeforeInk = g.pawPrint.sprite.material.opacity === 0;
    const printAt = g.pawPrint.stampedAt;
    g.scene.updateMatrixWorld(true);
    const printPosition = () => g.pawPrint.sprite.getWorldPosition(g.paws.R.pos.clone()).project(g.camera);
    const stamped = printPosition();
    g.orbitAzimuthTarget = 25;
    g.update(0.05);
    out.inkAppearsAfterContact = g.pawPrint.sprite.material.opacity > 0.5;
    g.scene.updateMatrixWorld(true);
    out.printFixedOnScreen = printPosition().distanceTo(stamped) < 1e-6;
    out.onlyOnePrintPerPunch = g.pawPrint.stampedAt === printAt;
    g.orbitAzimuthTarget = 0;
    for (let i = 0; i < 12; i++) g.update(0.05);
    out.printOutlastsFist = !g.swatPalm.visible && g.pawPrint.sprite.visible;
    for (let i = 0; i < 6; i++) g.update(0.05);
    out.printFades = g.pawPrint.sprite.material.opacity > 0 && g.pawPrint.sprite.material.opacity < 0.8;
    for (let i = 0; i < 20; i++) g.update(0.05);
    out.printExpires = !g.pawPrint.sprite.visible;
    out.swatDoesNotLatchAnnoyance = !g.isCross;
    out.alphaRenderer = g.renderer.getContext().getContextAttributes().alpha;
    g.headPatSwat.rolledAt = -Infinity;
    g.headPatSwat.resetGesture();
    out.resumedForPrivacy = rub3();
    g.headPatSwat.startedAt = g.elapsed * 1000 - 410;
    g.update(0.016);
    out.privacyInterruptsLivePunch = g.headPatSwat.isActive(g.elapsed * 1000) && g.pawPrint.sprite.visible;
    g.setPrivacyMode(true);
    out.privacyCancels = !g.headPatSwat.isActive(g.elapsed * 1000);
    out.privacyClearsPrint = !g.pawPrint.sprite.visible;
    g.update(0.05);
    out.privacyClearsAnger = g.longhairModel.eyes.every(
      (eye) => eye.uniforms.uAnger.value === 0,
    );
    g.headPatSwat.rolledAt = -Infinity;
    out.privacyNoSwat = !rub3();
    g.setPrivacyMode(false);
    g.headPatSwat.resetGesture();
    g.setHeadPatSwatChance(0);
    out.disabled = !rub3();
    g.headPatSwat.rolledAt = -Infinity;
    g.setHeadPatSwatChance(1);
    out.reenabled = rub3();
    g.headPatSwat.startedAt = g.elapsed * 1000 - 410;
    g.update(0.016);
    out.newPunchLeavesNewPrint = g.pawPrint.sprite.visible && g.pawPrint.stampedAt > printAt;
    g.setTailPickerActive(true);
    out.pickerClearsPrint = !g.pawPrint.sprite.visible;
    g.setTailPickerActive(false);
    g.headPatSwat.rolledAt = -Infinity;
    g.headPatSwat.resetGesture();
    out.resumesAfterPicker = rub3();
    g.headPatSwat.startedAt = g.elapsed * 1000 - 1000;
    g.update(0.016);
    out.completes = g.headPatSwat.pose(g.elapsed * 1000) === null;
    out.neutralEyesRestored = g.longhairModel.eyes.every(
      (eye) => eye.uniforms.uAnger.value === 0,
    );
    out.angerMarkRestored = !g.angerSprite.visible;
    out.palmTucksAway = !g.swatPalm.visible;
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
    g.headPatSwat.resetGesture();
    g.headPatSwat.rolledAt = -Infinity;
    g.setTailPickerActive(true);
    out.pickerDoesNotSwat = !rub3();
    g.setTailPickerActive(false);
    for (const layout of ["65", "108"]) {
      g.setKeyboardConfig(layout, "cat");
      g.update(0.016);
      g.renderer.render(g.scene, g.camera);
      const p = g.desk.keyTopWorld("enter").clone().project(g.camera);
      const hit = g.hitTestKeyAtClientPoint((p.x + 1) * 210, (1 - p.y) * 220);
      out["pickerRaycast" + layout] = hit?.id === "enter";
      const bounds = g.getKeyboardClientBounds();
      out["pickerBounds" + layout] = bounds.width > 100 && bounds.height > 10;
    }
    g.setKeyboardConfig("65", "cat");
    g.update(0.016);
    g.renderer.render(g.scene, g.camera);
    return out;
  });
  for (const [key, value] of Object.entries(checks.threeD))
    assert.equal(value, true, `3D ${key}`);
  if (capture)
    await page.evaluate(async () => {
      g.renderer.dispose();
      const previous = document.getElementById("cat");
      const canvas = document.createElement("canvas");
      canvas.id = "cat";
      canvas.style.cssText = previous.style.cssText;
      previous.replaceWith(canvas);
      const { KuroCatEngine3D } = await import("/src/catEngine3d.ts");
      window.g = new KuroCatEngine3D(canvas, { embedded: false });
      g.setCatSkin(skin);
      g.setHeadPatSwatChance(1);
      g.resize();
      g.update(0.016);
      g.renderer.render(g.scene, g.camera);
      rub3();
    });
  if (capture)
    for (let i = 0; i < 80; i++) {
      await page.evaluate(() => {
        g.update(0.032);
        g.renderer.render(g.scene, g.camera);
      });
      await page.screenshot({
        path: `${outputDir}/3d-${String(i).padStart(2, "0")}.png`,
        omitBackground: true,
      });
    }
  const ui = await browser.newPage({ viewport: { width: 420, height: 440 } });
  const uiErrors = [];
  ui.on("pageerror", (error) => uiErrors.push(error.message));
  await ui.addInitScript(() => {
    let id = 1;
    const callbacks = new Map();
    window.testEvents = {};
    window.testSettings = {
      x: null,
      y: null,
      scale: 1,
      alwaysOnTop: true,
      clickThroughLocked: false,
      showKeyBubbles: true,
      soundEnabled: false,
      autostart: false,
      catBreed: "orange-white-longhair",
      mcpEnabled: false,
      mcpPort: 27420,
      keyboardLayout: "65",
      keyboardOrientation: "cat",
      tailKeyMode: "smart",
      tailKeyIds: ["enter"],
      privacyPasswordGuard: true,
      obsEnabled: false,
      obsPort: 27421,
      obsHidePet: false,
      renderMode: "2d",
      collarColor: "none",
      headphoneMode: "off",
    };
    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback: (f) => {
        const n = id++;
        callbacks.set(n, f);
        return n;
      },
      unregisterCallback: (n) => callbacks.delete(n),
      invoke: async (cmd, args) => {
        if (cmd === "get_settings") return structuredClone(window.testSettings);
        if (cmd === "get_cats") {
          const m = await import("/src/catSkins.ts");
          return m.DEFAULT_BUILTIN_CATS;
        }
        if (cmd === "get_app_version") return "5.1.0";
        if (cmd === "plugin:event|listen") {
          window.testEvents[args.event] = callbacks.get(args.handler);
          return id++;
        }
        if (cmd === "is_win7_ulw_mode" || cmd === "get_game_active")
          return false;
        if (cmd === "update_settings") {
          window.testSettings = { ...args.patch };
          return structuredClone(window.testSettings);
        }
        return null;
      },
    };
  });
  await ui.goto("http://127.0.0.1:1456/menu.html");
  await ui.waitForFunction(() =>
    document.querySelector('[data-breed="orange-white-longhair"]'),
  );
  assert.equal(await ui.locator("#render-mode-row").isVisible(), false);
  await ui.evaluate(() =>
    document.querySelector('[data-rendermode="2d"]').click(),
  );
  await ui.waitForFunction(() => window.testSettings.renderMode === "3d");
  await ui.goto("http://127.0.0.1:1456/index.html");
  await ui.waitForFunction(
    () =>
      !document.querySelector("#pet-canvas-3d").classList.contains("hidden"),
  );
  assert.equal(await ui.locator("#pet-canvas").isVisible(), false);
  await ui.waitForFunction(
    () => typeof window.testEvents["kuro-open-tail-picker"] === "function",
  );
  await ui.evaluate(() =>
    window.testEvents["kuro-open-tail-picker"]({ payload: null }),
  );
  await ui.waitForFunction(
    () =>
      !document.querySelector("#tail-picker-bar").classList.contains("hidden"),
  );
  assert.equal(await ui.locator("#pet-canvas").isVisible(), false);
  assert.equal(await ui.locator("#pet-canvas-3d").isVisible(), true);

  await ui.goto('http://127.0.0.1:1456/obs.html?breed=orange-white-longhair&mode=2d');
  await ui.waitForFunction(()=>!document.querySelector('#obs-canvas-3d').classList.contains('hidden'));
  assert.equal(await ui.locator('#obs-canvas').isVisible(), false);
  await ui.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (["webgl", "webgl2", "experimental-webgl"].includes(type)) return null;
      return getContext.call(this, type, ...args);
    };
  });
  await ui.goto('http://127.0.0.1:1456/index.html');
  await ui.waitForFunction(
    () => !document.querySelector("#render-error").classList.contains("hidden"),
  );
  assert.equal(await ui.locator("#pet-canvas").isVisible(), false);
  assert.deepEqual(uiErrors, []);
  checks.ui = {
    facaiMenuHides2d: true,
    forced2dClickStill3d: true,
    mainUses3d: true,
    pickerStays3d: true,
    obsOverrideStays3d: true,
    missingGpuShowsErrorWithout2d: true,
  };
  await ui.close();

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
