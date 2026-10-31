import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import type { Severity, ZombieClip } from "./types";

interface SceneCallbacks {
  onProgress: (ratio: number) => void;
  onReady: () => void;
  onClip?: (clip: string) => void;
  onError: () => void;
}

export interface StageOptions {
  autoRotate: boolean;
  particles: boolean;
  bloom: boolean;
  reducedMotion?: boolean;
}

const MODEL_HEIGHT = 1.9;
const BASE_SPIN = 0.16;
const CAMERA_Z = 4.9;
const LOOK_Y = 1.15;
const BASE_CLIP: ZombieClip = "Walk";
const FRAME_INTERVAL = 1 / 30;
const POWER_PRIORITY = 100;
const THREAT: Record<Severity, number> = {
  info: 0,
  low: 0.12,
  medium: 0.35,
  high: 0.65,
  critical: 1,
};
const DEAD = new THREE.Color("#3a3a40");

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const smooth = (dt: number, speed: number) => 1 - Math.exp(-dt * speed);
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Also releases GLTFs that finish loading after the stage has unmounted. */
function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
      (object as THREE.SkinnedMesh).skeleton.dispose();
    }
  });
  textures.forEach((texture) => {
    const source = texture.source?.data;
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) source.close();
    texture.dispose();
  });
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

function canvasTexture(
  size: number,
  draw: (g: CanvasRenderingContext2D) => void,
) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.translate(size / 2, size / 2);
  g.strokeStyle = "#fff";
  g.fillStyle = "#fff";
  draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function ringTexture() {
  return canvasTexture(1024, (g) => {
    g.globalAlpha = 0.9;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, 500, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      const long = i % 15 === 0;
      g.globalAlpha = long ? 0.95 : 0.45;
      g.lineWidth = long ? 4 : 2;
      g.beginPath();
      g.moveTo(
        Math.cos(a) * (long ? 450 : 470),
        Math.sin(a) * (long ? 450 : 470),
      );
      g.lineTo(Math.cos(a) * 492, Math.sin(a) * 492);
      g.stroke();
    }
  });
}

function arcTexture() {
  return canvasTexture(1024, (g) => {
    g.lineWidth = 7;
    g.globalAlpha = 0.85;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.25;
      g.beginPath();
      g.arc(0, 0, 480, a, a + 0.9);
      g.stroke();
    }
    g.globalAlpha = 0.3;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, 400, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([4, 14]);
    g.beginPath();
    g.arc(0, 0, 440, 0, Math.PI * 2);
    g.stroke();
  });
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function additive(map: THREE.Texture, opacity: number) {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
}

export class ZombieScene {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  private pivot = new THREE.Group();
  private timer = new THREE.Timer();
  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver;
  private environmentTarget: THREE.WebGLRenderTarget;
  private active = true;
  private inViewport = true;
  private looping = false;
  private needsRender = true;
  private frameDelta = 0;
  private settleFor = 0;
  private bloomEnabled = true;
  private particlesEnabled = true;
  private loadTimeout: ReturnType<typeof setTimeout> | null = null;

  private top = new THREE.SpotLight("#e9f6ff", 0, 0, 0.42, 0.9, 2);
  private key = new THREE.SpotLight("#bcd7ff", 0, 0, 0.6, 1, 2);
  private rimA = new THREE.SpotLight("#ffffff", 0, 0, 0.42, 1, 2);
  private rimB = new THREE.SpotLight("#ffffff", 0, 0, 0.42, 1, 2);
  private ringOuter: THREE.Mesh;
  private ringInner: THREE.Mesh;
  private scanRing: THREE.Mesh;
  private shaft: THREE.Mesh;
  private dust: THREE.Points;
  private dustData: { speed: number; phase: number }[] = [];

  private accentTarget = new THREE.Color("#e8e8ee");
  private alertTarget = new THREE.Color("#ff2d3d");
  private accentCur = new THREE.Color("#e8e8ee");
  private alertCur = new THREE.Color("#ff2d3d");
  private white = new THREE.Color(0xffffff);
  private base = new THREE.Color();
  private hot = new THREE.Color();
  private tmp = new THREE.Color();

  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private busy = 0;
  private ready = false;
  private powered = true;
  private disposed = false;
  private reducedMotion = false;
  private powerTransition = false;
  private nextAmbient = rand(12, 20);
  private elapsed = 0;
  private introStart = -1;

  private threat = 0;
  private power = 1;
  private spin = BASE_SPIN;
  private spinTarget = BASE_SPIN;
  private dragging = false;
  private lastX = 0;
  private pointer = new THREE.Vector2();
  private shift = 0;
  private shiftTarget = 0;
  private width = 1;
  private height = 1;

  constructor(
    private container: HTMLElement,
    private cb: SceneCallbacks,
  ) {
    const w = (this.width = container.clientWidth || 1);
    const h = (this.height = container.clientHeight || 1);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "default",
    });
    try {
      this.renderer.setPixelRatio(this.pixelRatio());
      this.renderer.setSize(w, h);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.renderer.domElement.style.display = "block";
      container.appendChild(this.renderer.domElement);

      this.scene.background = new THREE.Color(0x000000);
      this.scene.fog = new THREE.FogExp2(0x000000, 0.05);
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      this.environmentTarget = pmrem.fromScene(room, 0.04);
      this.scene.environment = this.environmentTarget.texture;
      this.scene.environmentIntensity = 0.12;
      room.dispose();
      pmrem.dispose();

      this.camera.position.set(0, 1.25, CAMERA_Z);
      this.camera.lookAt(0, LOOK_Y, 0);
      this.scene.add(this.pivot);

      this.buildLights();
      this.buildFloor();
      this.ringOuter = this.buildRing(ringTexture(), 3.4, 0.25);
      this.ringInner = this.buildRing(arcTexture(), 2.7, 0.18);
      this.scanRing = this.buildScanRing();
      this.shaft = this.buildShaft();
      this.dust = this.buildDust();

      this.composer = new EffectComposer(
        this.renderer,
        new THREE.WebGLRenderTarget(w, h, {
          type: THREE.HalfFloatType,
          // Bloom needs a single-sample HDR target; multisampled float attachments
          // render black on some WebGL drivers. The canvas has native AA when direct.
        }),
      );
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.4, 0.7, 0.82);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      this.composer.setSize(w, h);

      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();

      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
      this.intersectionObserver = new IntersectionObserver(([entry]) => {
        if (this.disposed) return;
        this.inViewport = entry.isIntersecting;
        if (!this.inViewport) this.settlePose();
        this.syncLoop();
      }, { rootMargin: "40px" });
      this.intersectionObserver.observe(container);
      container.addEventListener("pointerdown", this.onDown);
      container.addEventListener("pointercancel", this.onUp);
      container.addEventListener("lostpointercapture", this.onUp);
      window.addEventListener("pointermove", this.onMove);
      window.addEventListener("pointerup", this.onUp);
      document.addEventListener("visibilitychange", this.onVisibility);
      this.renderer.domElement.addEventListener("webglcontextlost", this.onContextLost);
      this.timer.connect(document);
      this.wake();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  load(url: string) {
    this.loadTimeout = setTimeout(() => this.fail(), 30_000);
    new GLTFLoader().load(
      url,
      (gltf) => {
        if (this.disposed) {
          disposeObject(gltf.scene);
          return;
        }
        if (this.loadTimeout) clearTimeout(this.loadTimeout);
        this.loadTimeout = null;
        try {
          this.setupModel(gltf);
        } catch {
          if (!gltf.scene.parent) disposeObject(gltf.scene);
          this.fail();
        }
      },
      (e) => {
        if (!this.disposed) this.cb.onProgress(e.total ? e.loaded / e.total : 0);
      },
      () => this.fail(),
    );
  }

  setTheme(accent: string, alert: string) {
    this.accentTarget.set(accent);
    this.alertTarget.set(alert);
    this.wake(1.5);
  }

  setOptions(o: StageOptions) {
    const changed = this.reducedMotion !== (o.reducedMotion ?? false);
    this.reducedMotion = o.reducedMotion ?? false;
    this.spinTarget = o.autoRotate && !this.reducedMotion ? BASE_SPIN : 0;
    this.particlesEnabled = o.particles;
    this.bloomEnabled = o.bloom;
    this.dust.visible = o.particles && !this.reducedMotion && this.powered;
    if (changed) this.settlePose();
    this.wake();
  }

  setActive(active: boolean) {
    this.active = active;
    if (!active) this.settlePose();
    this.syncLoop();
  }

  // Slides the specimen sideways (fraction of the viewport width) to make room for page content.
  setShift(fraction: number) {
    this.shiftTarget = fraction;
    this.wake(this.reducedMotion ? 0 : 2);
  }

  setPowered(on: boolean) {
    if (on === this.powered) return;
    this.powered = on;
    this.threat = 0;
    this.dust.visible = on && this.particlesEnabled && !this.reducedMotion;
    if (!this.ready) {
      this.power = on ? 1 : 0.12;
      return;
    }
    if (this.reducedMotion || !this.canRender()) {
      this.power = on ? 1 : 0.12;
      this.settlePose();
      this.wake();
      return;
    }
    const death = this.actions.get("Death");
    if (!death) {
      this.settlePose();
      this.wake(2.5);
      return;
    }
    // Reversing the death clip makes power-on a coherent recovery from the same pose.
    // Power transitions interrupt every event and retain the highest priority until finished.
    const transitionTime = this.current === death ? death.time : on ? death.getClip().duration : 0;
    this.busy = POWER_PRIORITY;
    this.powerTransition = true;
    this.fadeTo(death, on ? 0.12 : 0.18);
    death.time = transitionTime;
    if (on) {
      death.setEffectiveTimeScale(-0.85);
    }
    this.wake(2.5);
  }

  /** Event cues only; operational power always wins over incoming telemetry. */
  play(clip: ZombieClip, priority = 1) {
    if (!this.ready || this.disposed || !this.powered || !this.canRender()) return;
    if (this.reducedMotion || this.powerTransition || clip === "Death") return;
    if (priority <= this.busy) return;
    const action = this.actions.get(clip);
    if (!action) return;
    this.busy = clip === BASE_CLIP ? 0 : priority;
    this.fadeTo(action, 0.24);
    this.nextAmbient = this.elapsed + rand(18, 28);
    this.wake();
  }

  pulse(severity: Severity) {
    if (this.reducedMotion || !this.powered || !this.canRender()) return;
    this.threat = Math.max(this.threat, THREAT[severity]);
    this.wake();
  }

  private settlePose() {
    if (!this.ready) return;
    const action = this.actions.get(this.powered ? BASE_CLIP : "Death");
    if (!action || !this.mixer) return;
    this.mixer.stopAllAction();
    action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (!this.powered) {
      action.time = action.getClip().duration;
      action.paused = true;
    }
    this.mixer.update(0);
    this.current = action;
    this.busy = 0;
    this.powerTransition = false;
    this.threat = 0;
    this.nextAmbient = this.elapsed + rand(12, 20);
    this.cb.onClip?.(this.powered ? BASE_CLIP : "Death");
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.timer.dispose();
    if (this.loadTimeout) clearTimeout(this.loadTimeout);
    this.container.removeEventListener("pointerdown", this.onDown);
    this.container.removeEventListener("pointercancel", this.onUp);
    this.container.removeEventListener("lostpointercapture", this.onUp);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onContextLost);

    disposeObject(this.scene);
    this.mixer?.stopAllAction();
    this.actions.clear();
    this.environmentTarget?.dispose();
    this.top.shadow.map?.dispose();
    this.composer?.passes.forEach((pass) => pass.dispose());
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private fail() {
    if (this.disposed) return;
    this.dispose();
    this.cb.onError();
  }

  private setupModel(gltf: {
    scene: THREE.Group;
    animations: THREE.AnimationClip[];
  }) {
    const model = gltf.scene;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });

    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      if (clip.name === BASE_CLIP) action.setLoop(THREE.LoopRepeat, Infinity);
      else {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(clip.name, action);
    }
    this.mixer.addEventListener("finished", (e) => {
      if (e.action !== this.current) return;
      this.busy = 0;
      this.powerTransition = false;
      this.nextAmbient = this.elapsed + rand(12, 20);
      const base = this.actions.get(BASE_CLIP);
      if (this.powered && base) this.fadeTo(base, 0.36);
    });

    // Measure in the neutral Idle pose so the skinned bounds are stable, then hand over to the base loop.
    const idle = this.actions.get("Idle");
    idle?.play();
    this.mixer.update(0);
    model.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model, true);
    const size = box.getSize(new THREE.Vector3());
    model.scale.setScalar(MODEL_HEIGHT / (size.y || 1));
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model, true);
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -box.min.y, -center.z);
    this.pivot.add(model);
    idle?.stop();

    this.current = null;
    this.ready = true;
    this.introStart = this.elapsed;
    this.cb.onProgress(1);
    this.cb.onReady();

    this.settlePose();
    this.wake(this.reducedMotion ? 0 : 2.5);
  }

  private fadeTo(next: THREE.AnimationAction, duration: number) {
    if (next === this.current) {
      next.reset().setEffectiveTimeScale(1).play();
      return;
    }
    next
      .reset()
      .setEffectiveTimeScale(1)
      .setEffectiveWeight(1)
      .fadeIn(duration)
      .play();
    this.current?.fadeOut(duration);
    this.current = next;
    this.cb.onClip?.(next.getClip().name);
  }

  private buildLights() {
    this.top.position.set(0, 7, 1.2);
    this.top.target.position.set(0, 0.9, 0);
    this.top.castShadow = true;
    const shadowSize = window.matchMedia("(max-width: 767px), (pointer: coarse)").matches ? 512 : 1024;
    this.top.shadow.mapSize.set(shadowSize, shadowSize);
    this.top.shadow.bias = -0.0004;
    this.key.position.set(3.2, 2.8, 4.6);
    this.key.target.position.set(0, 1, 0);
    this.rimA.position.set(-2.8, 2.6, -3.4);
    this.rimA.target.position.set(0, 1, 0);
    this.rimB.position.set(3, 2.2, -3.4);
    this.rimB.target.position.set(0, 1, 0);
    this.scene.add(
      this.top,
      this.top.target,
      this.key,
      this.key.target,
      this.rimA,
      this.rimA.target,
      this.rimB,
      this.rimB.target,
    );
  }

  private buildFloor() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x050505,
      roughness: 0.5,
      metalness: 0.55,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 96), mat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  private spinGround(angle: number) {
    this.ringOuter.rotation.z += angle;
    this.ringInner.rotation.z += angle;
  }

  private buildRing(map: THREE.Texture, size: number, opacity: number) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      additive(map, opacity),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.01;
    this.scene.add(mesh);
    return mesh;
  }

  private buildScanRing() {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.95, 0.005, 8, 128),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    mesh.rotation.x = Math.PI / 2;
    this.scene.add(mesh);
    return mesh;
  }

  private buildShaft() {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color("#cfe6ff") },
        uIntensity: { value: 0.16 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uIntensity;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          float f = abs(dot(normalize(vN), normalize(vV)));
          float a = pow(f, 1.6) * pow(vUv.y, 1.4) * smoothstep(0.0, 0.12, vUv.y) * uIntensity;
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(2.1, 7, 64, 1, true),
      mat,
    );
    mesh.position.y = 3.5;
    this.scene.add(mesh);
    return mesh;
  }

  private buildDust() {
    const count = 72;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(Math.random()) * 4.5;
      const a = Math.random() * Math.PI * 2;
      pos.set([Math.cos(a) * r, Math.random() * 5, Math.sin(a) * r], i * 3);
      this.dustData.push({
        speed: rand(0.03, 0.14),
        phase: Math.random() * 6.28,
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        map: glowTexture(),
        size: 0.07,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.scene.add(points);
    return points;
  }

  private resize() {
    if (this.disposed) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.applyView();
    this.wake();
  }

  private pixelRatio() {
    const compact = window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
    return Math.min(window.devicePixelRatio || 1, compact ? 1.25 : 1.5);
  }

  private canRender() {
    return !this.disposed && this.active && this.inViewport && !document.hidden;
  }

  private wake(seconds = 0) {
    this.needsRender = true;
    this.settleFor = Math.max(this.settleFor, seconds);
    this.syncLoop();
  }

  private syncLoop() {
    if (!this.canRender()) {
      this.renderer.setAnimationLoop(null);
      this.renderer.domElement.dataset.renderState = "paused";
      this.looping = false;
      return;
    }
    if (this.looping) return;
    this.needsRender = true;
    this.frameDelta = 0;
    this.timer.reset();
    this.renderer.setAnimationLoop(this.frame);
    this.renderer.domElement.dataset.renderState = "active";
    this.looping = true;
  }

  private onVisibility = () => {
    if (document.hidden) this.settlePose();
    this.syncLoop();
  };

  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.fail();
  };

  private applyView() {
    if (Math.abs(this.shift) > 1e-4) {
      this.camera.setViewOffset(
        this.width,
        this.height,
        -this.shift * this.width,
        0,
        this.width,
        this.height,
      );
    } else {
      this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
    }
  }

  private onDown = (e: PointerEvent) => {
    if (!this.canRender() || this.reducedMotion || !this.ready) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.container.setPointerCapture?.(e.pointerId);
    this.wake();
  };

  private onMove = (e: PointerEvent) => {
    if (!this.canRender() || this.reducedMotion || (!this.powered && !this.dragging)) return;
    this.pointer.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      (e.clientY / window.innerHeight) * 2 - 1,
    );
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    this.lastX = e.clientX;
    this.spinGround(dx * 0.012);
    this.spin = THREE.MathUtils.clamp(dx * 0.012 * 60, -6, 6);
    this.wake();
  };

  private onUp = () => {
    if (!this.dragging) return;
    this.dragging = false;
    this.wake(this.powered ? 0 : 0.15);
  };

  private frame = (time?: number) => {
    if (!this.canRender()) {
      this.syncLoop();
      return;
    }
    this.timer.update(time);
    // Update Timer on every RAF, but accumulate its deltas before dropping frames.
    // Reading only the latest delta on a capped loop would slow every animation down.
    this.frameDelta += this.timer.getDelta();
    if (!this.needsRender && this.frameDelta + 0.0001 < FRAME_INTERVAL) return;
    const dt = Math.min(this.frameDelta, 0.1);
    this.frameDelta = 0;
    this.needsRender = false;
    this.settleFor = Math.max(0, this.settleFor - dt);
    this.elapsed += dt;
    const t = this.elapsed;

    if (!this.reducedMotion) this.mixer?.update(dt);

    if (!this.dragging) {
      if (this.reducedMotion || !this.powered) this.spin = 0;
      this.spin += ((this.powered ? this.spinTarget : 0) - this.spin) * smooth(dt, 1.4);
      this.spinGround(this.spin * dt);
    }

    if (!this.reducedMotion && this.ready && this.powered && this.busy === 0 && t > this.nextAmbient) {
      this.nextAmbient = t + rand(18, 28);
      this.play("Walk_Grab", 0.25);
    }

    this.threat = Math.max(0, this.threat - dt * 0.45);
    this.power += ((this.powered ? 1 : 0.12) - this.power) * (this.reducedMotion ? 1 : smooth(dt, 2.5));
    const p = this.power;

    const k = this.reducedMotion ? 1 : smooth(dt, 4);
    this.accentCur.lerp(this.accentTarget, k);
    this.alertCur.lerp(this.alertTarget, k);
    const base = this.base.copy(DEAD).lerp(this.accentCur, p);
    const hot = this.hot.copy(base).lerp(this.alertCur, this.threat * p);

    this.rimA.color.copy(hot);
    this.rimA.intensity = (150 + this.threat * 220) * p;
    this.rimB.color.copy(this.tmp.copy(DEAD).lerp(this.alertCur, p * 0.85));
    this.rimB.intensity = (90 + this.threat * 160) * p;
    this.top.intensity = 170 * (0.25 + 0.75 * p);
    this.key.intensity = 55 * (0.2 + 0.8 * p);

    (this.ringOuter.material as THREE.MeshBasicMaterial).color.copy(hot);
    (this.ringInner.material as THREE.MeshBasicMaterial).color.copy(
      this.tmp.copy(base).lerp(this.alertCur, 0.45),
    );
    (this.scanRing.material as THREE.MeshBasicMaterial).color.copy(hot);
    (this.dust.material as THREE.PointsMaterial).color.copy(base);
    (this.dust.material as THREE.PointsMaterial).opacity = 0.08 + 0.12 * p;
    const shaftMat = this.shaft.material as THREE.ShaderMaterial;
    shaftMat.uniforms.uColor.value.copy(
      this.tmp.copy(base).lerp(this.white, 0.65),
    );
    shaftMat.uniforms.uIntensity.value = 0.018 + 0.035 * p;

    if (!this.reducedMotion && this.powered) {
      this.ringOuter.rotation.z -= dt * 0.12;
      this.ringInner.rotation.z += dt * 0.2;
    }
    const sweep = (Math.sin(t * 0.7) * 0.5 + 0.5) * MODEL_HEIGHT;
    this.scanRing.position.y = sweep;
    (this.scanRing.material as THREE.MeshBasicMaterial).opacity = this.reducedMotion || !this.powered ? 0 : 0.1 * p;
    this.bloom.enabled = this.bloomEnabled && p > 0.14 && !this.reducedMotion;
    this.bloom.strength = 0.13 + this.threat * 0.2;

    if (this.dust.visible) {
      const attr = this.dust.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      for (let i = 0; i < this.dustData.length; i++) {
        const d = this.dustData[i];
        let y = attr.getY(i) + d.speed * dt;
        if (y > 5) y = 0;
        attr.setY(i, y);
        attr.setX(i, attr.getX(i) + Math.sin(t * 0.4 + d.phase) * 0.0015);
      }
      attr.needsUpdate = true;
    }

    const shiftDelta = this.shiftTarget - this.shift;
    if (Math.abs(shiftDelta) > 1e-4) {
      this.shift += shiftDelta * (this.reducedMotion ? 1 : smooth(dt, 4));
      this.applyView();
    }

    const intro =
      this.introStart < 0
        ? 0
        : easeOutExpo(Math.min(1, (t - this.introStart) / 2.4));
    const dolly = this.reducedMotion ? 0 : (1 - intro) * 1.4;
    const s = smooth(dt, 2);
    this.camera.position.x +=
      ((this.reducedMotion || !this.powered ? 0 : this.pointer.x * 0.16) - this.camera.position.x) * s;
    this.camera.position.y +=
      (1.25 - (this.reducedMotion || !this.powered ? 0 : this.pointer.y * 0.08) - this.camera.position.y) * s;
    this.camera.position.z =
      CAMERA_Z +
      dolly +
      (this.camera.aspect < 0.62 ? (0.62 - this.camera.aspect) * 5 : 0);
    this.camera.lookAt(0, LOOK_Y - (1 - p) * 0.25, 0);

    if (this.bloom.enabled) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    // Offline and reduced-motion views become a still frame: no RAF or GPU work.
    if ((!this.powered && !this.powerTransition && this.settleFor === 0) || this.reducedMotion || !this.ready) {
      this.renderer.setAnimationLoop(null);
      this.renderer.domElement.dataset.renderState = "sleeping";
      this.looping = false;
    }
  };
}
