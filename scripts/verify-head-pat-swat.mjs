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
    window.rub3 = (side = 1) => {
      const { y, xs } = headLine();
      const a = xs[0],
        b = xs[xs.length - 1],
        m = (a + b) / 2;
      const random = Math.random;
      // Exercise the real detector and side draw, deterministically for media.
      Math.random = () => side < 0 ? 0 : 0.75;
      try {
        for (const x of [a, m, b, m, a, m, b]) {
          g.elapsed += 0.02;
          g.onWindowCursor(x, y, true);
        }
        return g.headPatSwat.isActive(g.elapsed * 1000);
      } finally {
        Math.random = random;
      }
    };
    window.scratchRowCenter = (canvas, row) => {
      const pixels = canvas.getContext("2d").getImageData(0, row, 256, 1).data;
      let sum = 0, count = 0;
      for (let x = 0; x < 256; x++) if (pixels[x * 4 + 3] > 100) { sum += x; count++; }
      return sum / count;
    };
  });
  checks.threeD = await page.evaluate(() => {
    const out = {};
    const paw = g.longhairModel.swatPaw;
    out.legacyFacai2dBecomes3d = resolveCatRenderMode(skin.id, "2d") === "3d";
    out.otherCatsKeep2d = resolveCatRenderMode("black", "2d") === "2d";
    out.headSwats = rub3();
    out.purrSuppressed = !g.petting;
    g.update(0.016);
    const raised = g.paws.R.pos.clone();
    g.headPatSwat.startedAt = g.elapsed * 1000 - 180;
    g.update(0.016);
    out.pawMoves = g.paws.R.pos.distanceTo(raised) > 0.3;
    out.rightSwatUsesRightPaw = g.headPatSwat.pose(g.elapsed * 1000).side === 1 &&
      paw.root.position.distanceTo(g.paws.R.pos) < 1e-6 && paw.root.scale.x > 0;
    out.angryEyes = g.longhairModel.eyes.every(
      (eye) => eye.uniforms.uAnger.value > 0.9,
    );
    out.airplaneEars = g.ears.every(
      (ear) => Math.abs(ear.group.rotation.z) > ear.tilt,
    );
    out.angerMark = g.angerSprite.visible;
    out.palmPadsVisible =
      paw.root.visible && paw.toes.length === 4 &&
      paw.toes.every((toe) => toe.children[1].material === paw.padMaterial);
    out.pawSharesOriginalForelegMaterial = paw.furMaterial === g.longhairModel.limbMaterial &&
      paw.toes.every((toe) => toe.children[0].material === g.longhairModel.limbMaterial);
    const expectedPad = paw.padMaterial.uniforms.uCream.value.clone().set(skin.noseColor)
      .lerp(paw.padMaterial.uniforms.uCream.value.clone().set(skin.pawOutlineColor), 0.22);
    out.padsFollowCharacterPalette = paw.padMaterial.uniforms.uCream.value.getHexString() === expectedPad.getHexString();
    out.padsHaveLowRelief = paw.toes.every((toe) => toe.children[1].scale.z < 0.01);
    out.clawsHiddenDuringWindup = paw.claws.every((claw) => !claw.visible);
    const windupCurl = paw.toes[0].rotation.x;
    const normal = new g.camera.position.constructor(0, 0, 1).applyQuaternion(
      paw.root.quaternion,
    );
    const towardViewer = g.camera.position
      .clone()
      .sub(paw.root.position)
      .normalize();
    out.palmFacesViewer = normal.dot(towardViewer) > 0.9;
    out.noScratchesBeforeContact = !g.clawScratches.sprite.visible;
    g.headPatSwat.startedAt = g.elapsed * 1000 - 410;
    g.update(0.016);
    out.fistClosesOnContact = paw.toes.every((toe) => toe.rotation.x > windupCurl + 0.5);
    out.clawTipsExtendOnContact = paw.claws.every((claw) => claw.visible && claw.scale.x > 0.95);
    out.contactLeavesScratches = g.clawScratches.sprite.visible && g.clawScratches.startedAt === g.elapsed;
    out.fistVisibleBeforeCuts = g.clawScratches.sprite.material.opacity === 0;
    const strikeAt = g.clawScratches.startedAt;
    g.scene.updateMatrixWorld(true);
    const scratchPosition = () => g.clawScratches.sprite.getWorldPosition(g.paws.R.pos.clone()).project(g.camera);
    const anchored = scratchPosition();
    g.orbitAzimuthTarget = 25;
    g.update(0.05);
    out.cutsAppearAfterContact = g.clawScratches.sprite.material.opacity > 0.5;
    g.scene.updateMatrixWorld(true);
    out.scratchesFixedOnScreen = scratchPosition().distanceTo(anchored) < 1e-6;
    out.onlyOneScratchSetPerPunch = g.clawScratches.startedAt === strikeAt;
    g.orbitAzimuthTarget = 0;
    for (let i = 0; i < 12; i++) g.update(0.05);
    const canvas = g.clawScratches.sprite.material.map.image;
    const pixels = canvas.getContext("2d").getImageData(0, 0, 256, 256).data;
    let tracks = 0, opaque = 0, inside = false;
    for (let x = 0; x < 256; x++) {
      const cut = pixels[(128 * 256 + x) * 4 + 3] > 100;
      if (cut && !inside) tracks++;
      inside = cut;
    }
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 100) opaque++;
    out.threeThinScratchTracks = tracks === 3 && opaque < 256 * 256 * 0.12;
    out.rightScratchesSlantLeft = scratchRowCenter(canvas, 60) > scratchRowCenter(canvas, 200);
    window.scratchTexture = canvas.toDataURL("image/png");
    out.scratchesOutlastFist = !paw.root.visible && g.clawScratches.sprite.visible;
    for (let i = 0; i < 6; i++) g.update(0.05);
    out.scratchesFade = g.clawScratches.sprite.material.opacity > 0 && g.clawScratches.sprite.material.opacity < 0.8;
    for (let i = 0; i < 20; i++) g.update(0.05);
    out.scratchesExpire = !g.clawScratches.sprite.visible;
    out.swatDoesNotLatchAnnoyance = !g.isCross;
    out.alphaRenderer = g.renderer.getContext().getContextAttributes().alpha;
    g.headPatSwat.rolledAt = -Infinity;
    g.headPatSwat.resetGesture();
    out.resumedForPrivacy = rub3();
    g.headPatSwat.startedAt = g.elapsed * 1000 - 410;
    g.update(0.016);
    out.privacyInterruptsLivePunch = g.headPatSwat.isActive(g.elapsed * 1000) && g.clawScratches.sprite.visible;
    g.setPrivacyMode(true);
    out.privacyCancels = !g.headPatSwat.isActive(g.elapsed * 1000);
    out.privacyClearsScratches = !g.clawScratches.sprite.visible;
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
    out.newPunchLeavesNewScratches = g.clawScratches.sprite.visible && g.clawScratches.startedAt > strikeAt;
    g.setTailPickerActive(true);
    out.pickerClearsScratches = !g.clawScratches.sprite.visible;
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
    out.palmTucksAway = !paw.root.visible;
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
  writeFileSync(`${outputDir}/scratch-texture.png`, Buffer.from(
    (await page.evaluate(() => window.scratchTexture)).split(",")[1], "base64",
  ));
  assert.deepEqual(Object.entries(checks.threeD).filter(([, value]) => !value), [], "3D render checks");
  checks.leftPaw = await page.evaluate(() => {
    const out = {}, paw = g.longhairModel.swatPaw;
    g.cancelHeadPatSwat();
    g.headPatSwat.rolledAt = -Infinity;
    out.leftGestureSelected = rub3(-1) && g.headPatSwat.pose(g.elapsed * 1000).side === -1;
    g.lastMouse = g.elapsed;
    g.headPatSwat.startedAt = g.elapsed * 1000 - 180;
    g.update(0.033);
    out.leftPawRaised = paw.root.position.distanceTo(g.paws.L.pos) < 1e-6 && g.paws.L.pos.x < 0;
    out.rightPawNotHijacked = g.paws.R.pos.y < g.paws.L.pos.y - 0.4;
    out.leftGripMirrored = paw.root.visible && paw.root.scale.x < 0;
    out.leftSwatOverridesMouse = g.isMousing() && g.paws.L.pos.y > 1;
    g.headPatSwat.startedAt = g.elapsed * 1000 - 410;
    g.update(0.033);
    out.leftClawTipsAndCuts = paw.claws.every((claw) => claw.visible) && g.clawScratches.sprite.visible;
    for (let i = 0; i < 4; i++) g.update(0.033);
    const canvas = g.clawScratches.sprite.material.map.image;
    out.leftScratchesSlantRight = scratchRowCenter(canvas, 60) < scratchRowCenter(canvas, 200);
    g.scene.updateMatrixWorld(true);
    out.leftScratchesOnLeft = g.clawScratches.sprite.getWorldPosition(g.paws.L.pos.clone()).project(g.camera).x < 0;
    for (let i = 0; i < 18; i++) { g.lastMouse = g.elapsed; g.update(0.05); }
    out.leftReturnsToMouse = !paw.root.visible &&
      g.paws.L.pos.distanceTo(g.desk.mouseTopWorld(g.paws.L.pos.clone())) < 0.25;
    const hadScratches = g.clawScratches.sprite.visible;
    g.setPrivacyMode(true);
    out.privacyClearsLeftScratches = hadScratches && !g.clawScratches.sprite.visible;
    g.setPrivacyMode(false);
    return out;
  });
  assert.deepEqual(Object.entries(checks.leftPaw).filter(([, value]) => !value), [], "Left paw checks");
  if (capture) for (const [label, side] of [["right", 1], ["left", -1]]) {
    await page.evaluate(async (side) => {
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
      rub3(side);
    }, side);
    for (let i = 0; i < 80; i++) {
      await page.evaluate(() => {
        g.update(0.032);
        g.renderer.render(g.scene, g.camera);
      });
      await page.screenshot({
        path: `${outputDir}/3d-${label}-${String(i).padStart(2, "0")}.png`,
        omitBackground: true,
      });
    }
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
