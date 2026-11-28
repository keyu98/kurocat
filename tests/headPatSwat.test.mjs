import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/headPatSwat.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { HeadPatSwat, normalizeSwatChance, SWAT_DURATION_MS } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);

function rub(swat, start, random = () => 0, eligible = true) {
  return [0, 20, 40, 20, 0, 20, 40].some((x, i) =>
    swat.move(x, 0, start + i * 20, eligible, random),
  );
}

test("deliberate back-and-forth strokes trigger; hover, jitter and one pass do not", () => {
  const s = new HeadPatSwat();
  s.chance = 1;
  for (let i = 0; i < 100; i++)
    assert.equal(s.move(i % 2, 0, i * 10, true), false);
  s.resetGesture();
  for (const x of [0, 20, 40, 60])
    assert.equal(s.move(x, 0, 2000, true), false);
  s.resetGesture();
  assert.equal(rub(s, 3000), true);
  assert.equal(
    rub(new HeadPatSwat(), 3000, () => 0, false),
    false,
  );
});

test("probability boundaries and disabled setting", () => {
  const off = new HeadPatSwat();
  off.chance = 0;
  assert.equal(
    rub(off, 0, () => 0),
    false,
  );
  assert.equal(
    rub(new HeadPatSwat(), 0, () => 0.249),
    true,
  );
  assert.equal(
    rub(new HeadPatSwat(), 0, () => 0.25),
    false,
  );
  const on = new HeadPatSwat();
  on.chance = 1;
  assert.equal(
    rub(on, 0, () => 0.999),
    true,
  );
});

test("a normal outcome consumes the cooldown; continued motion cannot reroll every frame", () => {
  const s = new HeadPatSwat();
  let rolls = 0;
  assert.equal(
    rub(s, 0, () => {
      rolls++;
      return 0.9;
    }),
    false,
  );
  s.resetGesture();
  assert.equal(
    rub(s, 1000, () => {
      rolls++;
      return 0;
    }),
    false,
  );
  assert.equal(rolls, 1);
  s.resetGesture();
  assert.equal(
    rub(s, 3200, () => {
      rolls++;
      return 0;
    }),
    true,
  );
  assert.equal(rolls, 2);
});

test("anger covers the swat and the animation completes without restarting", () => {
  const s = new HeadPatSwat();
  s.chance = 1;
  assert.equal(rub(s, 0), true);
  const start = 100; // second reversal in rub()
  let angrySamples = 0;
  for (let i = 0; i < SWAT_DURATION_MS; i += 10) {
    const pose = s.pose(start + i);
    assert.ok(
      pose && Number.isFinite(pose.x) && pose.weight >= 0 && pose.weight <= 1,
    );
    assert.ok(pose.anger >= 0 && pose.anger <= 1);
    if (pose.anger === 1) angrySamples++;
  }
  assert.equal(s.pose(start).anger, 0);
  assert.ok(
    angrySamples > 40,
    "anger must stay visible through windup and impact",
  );
  assert.equal(rub(s, 200), false);
  assert.equal(s.pose(start + SWAT_DURATION_MS), null);
});

test("leaving the head or a long pause resets an incomplete gesture; cancel stops animation", () => {
  const s = new HeadPatSwat();
  s.chance = 1;
  for (const x of [0, 20, 40, 20]) s.move(x, 0, 0, true);
  s.move(0, 0, 10, false);
  assert.equal(s.move(20, 0, 20, true), false);
  assert.equal(s.move(0, 0, 2000, true), false);
  s.resetGesture();
  assert.equal(rub(s, 3000), true);
  s.cancel();
  assert.equal(s.pose(3150), null);
});

test("persisted/custom chances normalize safely", () => {
  assert.equal(normalizeSwatChance(undefined), 0.25);
  assert.equal(normalizeSwatChance(NaN), 0.25);
  assert.equal(normalizeSwatChance(Infinity), 0.25);
  assert.equal(normalizeSwatChance(-1), 0);
  assert.equal(normalizeSwatChance(2), 1);
  assert.equal(normalizeSwatChance(0.3), 0.3);
});
