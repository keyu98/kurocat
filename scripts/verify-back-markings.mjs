import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const { values } = parseArgs({ options: {
  output: { type: 'string', default: 'artifacts/back-markings/after' },
  'record-before': { type: 'boolean', default: false },
  'stills-only': { type: 'boolean', default: false },
  'source-ref': { type: 'string' },
} });
const output = values.output;
mkdirSync(output, { recursive: true });
const baseline = values['source-ref'] && execFileSync('git', [
  'show', `${values['source-ref']}:src/longhair3d.ts`,
], { encoding: 'utf8' });
const materialPath = fileURLToPath(new URL('../src/longhair3d.ts', import.meta.url));
const server = await createServer({
  server: { host: '127.0.0.1', port: 1457, strictPort: true },
  plugins: baseline ? [{
    name: 'record-baseline-coat', enforce: 'pre',
    load(id) { if (id === materialPath) return baseline; },
  }] : [],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--renderer-process-limit=1', '--num-raster-threads=1'],
  });
  const page = await browser.newPage({ viewport: { width: 520, height: 520 }, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/back-markings-test', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<body style="margin:0;background:transparent"><canvas id="cat" style="width:520px;height:520px"></canvas></body>',
  }));
  await page.goto('http://127.0.0.1:1457/back-markings-test');
  await page.evaluate(async () => {
    window.THREE = await import('/node_modules/three/build/three.module.js');
    const { KuroCatEngine3D } = await import('/src/catEngine3d.ts');
    const { ORANGE_WHITE_LONGHAIR } = await import('/src/catSkins.ts');
    window.reset = () => {
      if (window.g) {
        g.stop();
        g.scene.traverse((object) => {
          object.geometry?.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material?.dispose();
        });
        g.renderer.dispose();
      }
      // Repeat the same pose, blink and tail phase for both revisions.
      Math.random = () => 0.5;
      window.g = new KuroCatEngine3D(document.getElementById('cat'), { embedded: false });
      g.setCatSkin(ORANGE_WHITE_LONGHAIR);
      g.setHeadPatSwatChance(1);
      g.resize();
      for (let i = 0; i < 60; i++) g.update(1 / 60);
    };
    window.view = (azimuth, elevation) => {
      const az = azimuth * Math.PI / 180, el = elevation * Math.PI / 180;
      const anchor = new THREE.Vector3(0.06, 0.82, 0.36);
      g.camera.position.set(
        anchor.x + Math.sin(az) * Math.cos(el) * 8.1,
        anchor.y + Math.sin(el) * 8.1,
        anchor.z + Math.cos(az) * Math.cos(el) * 8.1,
      );
      g.camera.lookAt(anchor);
      g.renderer.render(g.scene, g.camera);
    };
    window.swat = (side) => {
      let now = g.elapsed * 1000;
      for (const x of [0, 20, 40, 20, 0, 20, 40]) {
        now += 20;
        g.headPatSwat.move(x, 0, now, true, () => side < 0 ? 0 : 0.75);
      }
      g.elapsed = now / 1000;
      if (!g.headPatSwat.isActive(now)) throw Error('Swat did not start');
    };
    window.alphaCheck = () => {
      const gl = g.renderer.getContext();
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let clear = 0, opaque = 0, feathered = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] === 0) clear++;
        else if (pixels[i] === 255) opaque++;
        else feathered++;
      }
      return { clear, opaque, feathered, alpha: gl.getContextAttributes().alpha };
    };
    reset();
  });
  const alpha = {};
  const capture = async (name, azimuth, elevation) => {
    const frame = await page.evaluate(([az, el]) => {
      view(az, el);
      return {
        alpha: alphaCheck(),
        png: g.renderer.domElement.toDataURL('image/png').split(',')[1],
      };
    }, [azimuth, elevation]);
    alpha[name] = frame.alpha;
    assert.deepEqual(errors, [], `${name}: browser/shader errors`);
    assert.equal(alpha[name].alpha, true);
    assert.ok(alpha[name].clear > 100000 && alpha[name].opaque > 10000, `${name}: transparent canvas and visible pet`);
    writeFileSync(`${output}/${name}.png`, Buffer.from(frame.png, 'base64'));
  };
  for (const [name, az, el] of [
    ['front', 0, 24.5], ['side-left', -110, 24.5], ['side-right', 110, 24.5],
    ['back', 165, 24.5], ['high-back', 165, 58], ['back-center', 180, 18],
  ]) await capture(name, az, el);

  const frontMarkings = await page.evaluate(() => {
    reset();
    view(0, 24.5);
    const gl = g.renderer.getContext();
    const countOrange = (x, y, width, height) => {
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(x, gl.drawingBufferHeight - y - height, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 255 && pixels[i] - pixels[i + 2] > 65 && pixels[i] - pixels[i + 1] > 35) count++;
      }
      return count;
    };
    return {
      tailRootOrangePixels: countOrange(518, 390, 26, 100),
      tailOrangePixels: countOrange(600, 315, 80, 120),
    };
  });
  if (!values['record-before']) {
    assert.ok(frontMarkings.tailRootOrangePixels > 0, `orange tail root: ${JSON.stringify(frontMarkings)}`);
    assert.ok(frontMarkings.tailOrangePixels > 1000, `orange tail: ${JSON.stringify(frontMarkings)}`);
  }

  for (const side of values['stills-only'] ? [] : [-1, 1]) {
    await page.evaluate((side) => { reset(); swat(side); }, side);
    for (let frame = 0; frame < 25; frame++) {
      await page.evaluate(() => g.update(0.032));
      // Inspect the full action with the same material, including the nod and return.
      const name = `swat-${side < 0 ? 'left' : 'right'}-${String(frame).padStart(2, '0')}`;
      await capture(name, 165, 58);
      if (frame === 8) await capture(`swat-${side < 0 ? 'left' : 'right'}-front`, 0, 24.5);
    }
    assert.equal(await page.evaluate(() => g.headPatSwat.isActive(g.elapsed * 1000)), false);
  }
  if (!values['stills-only']) {
    await page.evaluate(() => { reset(); g.triggerSleepDemo(); });
    for (let frame = 0; frame < 30; frame++) {
      await page.evaluate(() => g.update(0.1));
      await capture(`sleep-${String(frame).padStart(2, '0')}`, 165, 58);
    }
    await capture('sleep-side', 110, 24.5);
  }

  // Read actual GPU output at rest-space locations on the rendered coat mesh.
  // This catches material/geometry coordinate mistakes as well as shader regressions.
  const probes = await page.evaluate(() => {
    reset();
    view(180, 18);
    const body = g.longhairModel.body;
    const geometry = body.geometry;
    const positions = geometry.attributes.position;
    const coat = geometry.attributes.coatPosition;
    const camera = g.camera;
    const gl = g.renderer.getContext();
    const probes = {};
    for (const [name, x, y] of [
      ['shoulder-center', 0, 0.52], ['shoulder-left', -0.30, 0.50], ['shoulder-right', 0.30, 0.50],
      ['upper-back-center', 0, 0.26], ['spine-middle', 0, -0.08], ['spine-lower', 0, -0.42],
      ['flank-left', -0.67, -0.04], ['flank-right', 0.67, -0.04],
      ['hip-left', -0.58, -0.57], ['hip-right', 0.58, -0.57], ['rump', 0, -0.83],
    ]) {
      let nearest = -1, distance = Infinity;
      for (let i = 0; i < coat.count; i++) {
        if (coat.getZ(i) > -0.2) continue;
        const d = (coat.getX(i) - x) ** 2 + (coat.getY(i) - y) ** 2;
        if (d < distance) { nearest = i; distance = d; }
      }
      const p = new THREE.Vector3().fromBufferAttribute(positions, nearest);
      p.applyMatrix4(body.material.uniforms.uTorsoPose.value);
      p.y *= 1 - body.material.uniforms.uSquash.value * THREE.MathUtils.smoothstep(positions.getY(nearest), 0.18, 1.98);
      p.applyMatrix4(body.matrixWorld).project(camera);
      const pixel = new Uint8Array(4);
      gl.readPixels(Math.round((p.x + 1) / 2 * gl.drawingBufferWidth),
        Math.round((p.y + 1) / 2 * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      probes[name] = { rgba: [...pixel], orange: pixel[0] - pixel[2] > 65 && pixel[0] - pixel[1] > 35 };
    }
    return probes;
  });
  if (!values['record-before']) {
    const orangeProbes = new Set([
      'shoulder-center', 'shoulder-left', 'shoulder-right', 'upper-back-center', 'spine-middle', 'spine-lower',
      'flank-right', 'hip-right',
    ]);
    for (const [name, probe] of Object.entries(probes)) {
      assert.equal(probe.orange, orangeProbes.has(name), `${name}: ${JSON.stringify(probe)}`);
      assert.equal(probe.rgba[3], 255, `${name}: coat must remain opaque`);
    }
  }
  assert.deepEqual(errors, []);
  const report = { sourceRef: values['source-ref'] ?? 'working-tree', captures: Object.keys(alpha).length, frontMarkings, probes, alpha, errors };
  writeFileSync(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ captures: report.captures, frontMarkings, probes, errors }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
