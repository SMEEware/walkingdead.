import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as THREE from "three";

// The scene constructor needs WebGL. Compile its TS in memory so lifecycle tests
// can exercise its real methods and mixers without starting a browser or GPU.
const source = await readFile(new URL("../lib/zombie-scene.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/from "(three[^\"]*)"/g, (_, name) => `from ${JSON.stringify(import.meta.resolve(name))}`);
const { ZombieScene } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const DEAD_POSE = -Math.PI / 2;

function fixture({ powered = true, reducedMotion = false, visible = true } = {}) {
  const scene = Object.create(ZombieScene.prototype);
  const clips = [];
  Object.assign(scene, {
    actions: new Map(), pivot: new THREE.Group(), current: null, mixer: null,
    cb: { onProgress() {}, onReady() {}, onClip: (clip) => clips.push(clip) },
    powered, reducedMotion, disposed: false, ready: false, elapsed: 0,
    dust: { visible: true }, particlesEnabled: true, power: powered ? 1 : 0.12,
    busy: 0, powerTransition: false,
    canRender: () => visible, wake() {},
  });
  const model = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial());
  body.name = "Body";
  model.add(body);
  const clip = (name, duration, values, times = [0, duration]) => new THREE.AnimationClip(name, duration, [
    new THREE.NumberKeyframeTrack("Body.rotation[x]", times, values),
  ]);
  // These are the actual GLB's clip names and durations. A single synthetic bone
  // track makes final-pose regressions visible while keeping the fixture small.
  scene.setupModel({ scene: model, animations: [
    clip("Idle", 3, [0, 0]),
    clip("Death", 7 / 3, [0, DEAD_POSE]),
    clip("HitReact", 13 / 15, [0, -0.2, 0], [0, 0.3, 13 / 15]),
    clip("Walk", 1.2, [0, 0]),
    clip("Walk_Grab", 1.2, [0, 0]),
  ] });
  return {
    scene,
    advance: (seconds) => scene.mixer.update(seconds),
    clip: () => clips.at(-1),
    pose: () => body.rotation.x,
    hide: () => { visible = false; },
  };
}
const assertDead = (f) => {
  assert.equal(f.clip(), "Death");
  assert.ok(Math.abs(f.pose() - DEAD_POSE) < 1e-6, "body must remain in the final death pose");
};

test("shutdown interrupts an event and rejects later telemetry while dormant", () => {
  const f = fixture();
  assert.equal(f.clip(), "Walk");
  f.scene.play("HitReact", 2);
  f.advance(0.3);
  assert.equal(f.clip(), "HitReact");
  f.scene.setPowered(false);
  f.advance(2.5);
  assertDead(f);
  f.scene.play("Walk_Grab", 999);
  f.scene.play("HitReact", 999);
  f.scene.pulse("critical");
  f.advance(10);
  assertDead(f);
});

test("power-on reverses the corpse pose and returns to idle before accepting events", () => {
  const f = fixture({ powered: false });
  assertDead(f);
  f.scene.setPowered(true);
  f.scene.play("HitReact", 999);
  f.advance(0.2);
  assert.equal(f.clip(), "Death", "telemetry must not interrupt recovery");
  assert.ok(f.pose() > DEAD_POSE && f.pose() < 0, "recovery must move back toward standing");
  f.advance(2.7);
  assert.equal(f.clip(), "Walk");
  f.advance(0.5);
  assert.ok(Math.abs(f.pose()) < 1e-6);
  f.scene.play("HitReact", 2);
  assert.equal(f.clip(), "HitReact");
  f.advance(1);
  assert.equal(f.clip(), "Walk");
});

test("rapid off/on/off settles into the final requested offline state", () => {
  const f = fixture();
  f.scene.setPowered(false);
  f.advance(0.3);
  const falling = f.pose();
  f.scene.setPowered(true);
  f.advance(0.1);
  assert.ok(f.pose() > falling, "a mid-fall restart must reverse the existing motion");
  f.scene.setPowered(false);
  f.scene.play("HitReact", 999);
  f.advance(2.5);
  assertDead(f);
  f.advance(5);
  assertDead(f);
});

test("reduced motion uses stable power poses and ignores ambient/event animation", () => {
  const f = fixture({ reducedMotion: true });
  f.scene.play("Walk_Grab", 999);
  f.scene.play("HitReact", 999);
  assert.equal(f.clip(), "Walk");
  f.scene.setPowered(false);
  assertDead(f);
  f.scene.setPowered(true);
  assert.equal(f.clip(), "Walk");
  assert.ok(Math.abs(f.pose()) < 1e-6);
});

test("offline initialization and hidden power changes immediately use the correct pose", () => {
  assertDead(fixture({ powered: false, visible: false }));
  const f = fixture();
  f.hide();
  f.scene.setPowered(false);
  assertDead(f);
  f.scene.setPowered(true);
  assert.equal(f.clip(), "Walk");
  f.scene.play("HitReact", 999);
  assert.equal(f.clip(), "Walk", "hidden telemetry must not be replayed later");
});
