import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Exercise the real desktop entry point with only native IPC mocked. No test hooks ship.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, process.env.KUROCAT_CAPTURE_DIR || '.verification/longhair');
await mkdir(output, { recursive: true });
const server = await createServer({ root, server: { port: 0, strictPort: false } });
await server.listen();
let browser;
const results = {};
try {
  const origin = `http://localhost:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 420, height: 440 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(`${origin}/`, async (route) => {
    const response = await route.fetch();
    const setup = `<script type="module">
      import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      import { emit } from '/node_modules/@tauri-apps/api/event.js';
      import { DEFAULT_BUILTIN_CATS } from '/src/catSkins.ts';
      let settings = JSON.parse(localStorage.getItem('verify-settings') || 'null') || {
        x: null, y: null, scale: 1, alwaysOnTop: true, clickThroughLocked: false,
        showKeyBubbles: true, soundEnabled: false, autostart: false,
        catBreed: 'black', mcpEnabled: false, mcpPort: 27420,
        keyboardLayout: '65', keyboardOrientation: 'cat', privacyPasswordGuard: true,
        tailKeyMode: 'smart', tailKeyIds: ['enter','space','bs','esc'],
        renderMode: '2d', collarColor: 'none', headphoneMode: 'off'
      };
      mockWindows('main');
      mockIPC(async (cmd, args) => {
        if (cmd === 'get_settings') return settings;
        if (cmd === 'get_cats') return DEFAULT_BUILTIN_CATS;
        if (cmd === 'get_app_version') return '5.1.0';
        if (cmd === 'update_settings') {
          settings = { ...settings, ...args.patch };
          localStorage.setItem('verify-settings', JSON.stringify(settings));
          await emit('kuro-settings', settings);
          return settings;
        }
        if (cmd === 'get_game_active' || cmd === 'is_win7_ulw_mode') return false;
        if (cmd === 'open_context_menu') throw new Error('use inline menu in browser');
        if (cmd === 'check_for_update' || cmd === 'get_cached_update_info') return null;
        return null;
      }, { shouldMockEvents: true });
      const { KuroCatEngine } = await import('/src/catEngine.ts');
      const render = KuroCatEngine.prototype.render;
      KuroCatEngine.prototype.render = function () {
        render.call(this);
        window.verifyEngine = this;
      };
      await import('/src/main.ts');
    </script>`;
    await route.fulfill({ response, body: (await response.text()).replace(
      '<script type="module" src="/src/main.ts"></script>', setup) });
  });
  const openMenu = async () => {
    await page.locator('#pet-canvas').click({ button: 'right', position: { x: 390, y: 50 } });
    await page.locator('#context-menu').waitFor({ state: 'visible' });
  };
  const emit = (event, payload) => page.evaluate(async ({ event, payload }) => {
    const api = await import('/node_modules/@tauri-apps/api/event.js');
    await api.emit(event, payload);
  }, { event, payload });
  await page.goto(origin);
  await page.waitForFunction(() => window.verifyEngine);
  await openMenu();
  await page.locator('[data-breed="orange-white-longhair"]').click();
  await page.waitForFunction(() => window.verifyEngine.customSkin?.id === 'orange-white-longhair');
  // A retained 3D preference must still display the procedural coat, including after restart.
  await page.evaluate(async () => {
    const { invoke } = await import('/node_modules/@tauri-apps/api/core.js');
    await invoke('update_settings', { patch: { renderMode: '3d' } });
  });
  await openMenu();
  assert(await page.locator('[data-rendermode="2d"]').evaluate((b) => b.classList.contains('active')));
  assert(await page.locator('[data-rendermode="3d"]').isDisabled());
  await page.locator('#context-menu').screenshot({ path: path.join(output, 'selection.png') });
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(() => window.verifyEngine?.customSkin?.id === 'orange-white-longhair');
  assert(await page.locator('#pet-canvas').isVisible());
  assert(!(await page.locator('#pet-canvas-3d').isVisible()));
  results.selectionAndRestart = 'pass (saved 3D preference, effective 2D renderer)';

  // Pixel checks prove transparent RGBA output, with no opaque background or clipped canvas edge.
  results.alpha = await page.evaluate(() => {
    const canvas = document.querySelector('#pet-canvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = 0;
    let transparent = 0;
    let edge = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const a = pixels[(y * canvas.width + x) * 4 + 3];
      if (a) visible++; else transparent++;
      if ((x === 0 || y === 0 || x === canvas.width - 1 || y === canvas.height - 1) && a) edge++;
    }
    return { visible, transparent, opaqueEdgePixels: edge };
  });
  assert(results.alpha.visible > 10000 && results.alpha.transparent > 10000);
  assert.equal(results.alpha.opaqueEdgePixels, 0);
  await page.screenshot({ path: path.join(output, 'idle.png'), omitBackground: true });
  await page.addStyleTag({ content: 'html {background:repeating-conic-gradient(#e7e9ed 0% 25%,#f5f6f8 0% 50%) 0/24px 24px !important}' });
  await page.screenshot({ path: path.join(output, 'preview.png') });

  if (process.env.KUROCAT_RECORD_DEMO === '1') {
    const recording = await page.evaluate(async () => {
      const source = document.querySelector('#pet-canvas');
      const capture = document.createElement('canvas');
      capture.width = source.width; capture.height = source.height;
      const ctx = capture.getContext('2d');
      const stream = capture.captureStream(60);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 3000000 });
      const chunks = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const finished = new Promise((resolve) => { recorder.onstop = resolve; });
      const engine = window.verifyEngine;
      const start = performance.now();
      let keyDown = false;
      const paint = () => {
        const elapsed = performance.now() - start;
        const typing = elapsed > 1000 && elapsed < 3400 && Math.floor(elapsed / 160) % 2 === 0;
        if (typing !== keyDown) {
          if (typing) engine.onKeyDown(65, false); else engine.onKeyUp(65);
          keyDown = typing;
        }
        if (elapsed > 3500 && elapsed < 5100) engine.onGlobalMouseMove(0.5 + Math.sin(elapsed / 500) * 0.4, 0.6);
        engine.setPrivacyMode(elapsed > 5200 && elapsed < 6300);
        for (let y = 0; y < capture.height; y += 24) for (let x = 0; x < capture.width; x += 24) {
          ctx.fillStyle = (x / 24 + y / 24) % 2 ? '#e7e9ed' : '#f5f6f8';
          ctx.fillRect(x, y, 24, 24);
        }
        ctx.drawImage(source, 0, 0);
        if (elapsed < 7400) requestAnimationFrame(paint); else recorder.stop();
      };
      recorder.start(); paint();
      await finished;
      stream.getTracks().forEach((track) => track.stop());
      return await new Promise((resolve) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' }));
      });
    });
    await writeFile(path.join(output, 'animation.webm'), Buffer.from(recording, 'base64'));
  }

  // Wait beyond the previous 3-second idle cutoff, then measure rendered frames (not rAF callbacks).
  await page.waitForTimeout(3600);
  results.idlePacing = await page.evaluate(() => new Promise((resolve) => {
    const engine = window.verifyEngine;
    const samples = [];
    let previous = performance.now();
    engine.onAfterRender = () => {
      const now = performance.now(); samples.push(now - previous); previous = now;
    };
    setTimeout(() => {
      engine.onAfterRender = null;
      const sorted = samples.slice(1).sort((a, b) => a - b);
      resolve({ frames: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * 0.95)] });
    }, 1800);
  }));
  assert(results.idlePacing.frames > 65, JSON.stringify(results.idlePacing));
  assert(results.idlePacing.medianMs < 27, JSON.stringify(results.idlePacing));

  await emit('kuro-input', { kind: 'mouseMove', nx: 0.1, ny: 0.7 });
  await emit('kuro-input', { kind: 'mouseDown', button: 'left' });
  await emit('kuro-input', { kind: 'keyDown', vk: 65, scan: 0, repeat: false });
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => window.verifyEngine.leftPaw.mode === 'mouse'));
  await page.screenshot({ path: path.join(output, 'typing.png') });
  await emit('kuro-input', { kind: 'keyUp', vk: 65, scan: 0 });
  await emit('kuro-input', { kind: 'mouseUp', button: 'left' });
  await emit('kuro-privacy', true);
  await page.waitForTimeout(350);
  assert(await page.evaluate(() => window.verifyEngine.privacyClose > 0.9));
  await page.screenshot({ path: path.join(output, 'privacy.png') });
  await emit('kuro-privacy', false);
  await page.evaluate(async () => {
    const { invoke } = await import('/node_modules/@tauri-apps/api/core.js');
    await invoke('update_settings', { patch: { keyboardLayout: '108', keyboardOrientation: 'viewer' } });
  });
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => window.verifyEngine.getLogicalSize()), { w: 540, h: 456 });
  results.interactions = 'pass (mouse + keyboard, privacy, 108-key viewer layout)';

  await page.goto(`${origin}/obs.html?breed=orange-white-longhair&mode=3d`);
  await page.waitForTimeout(500);
  assert(await page.locator('#obs-canvas').isVisible());
  assert(!(await page.locator('#obs-canvas-3d').isVisible()));
  results.obs = 'pass (3D override still uses Canvas coat)';
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(results, null, 2));
  console.log(`Screenshots: ${path.relative(root, output)}`);
} finally {
  await browser?.close();
  await server.close();
}
