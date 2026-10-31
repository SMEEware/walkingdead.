import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const sourceUrl = new URL(
  "../../assets/models/feral-walker.glb",
  import.meta.url,
);
const outputUrl = new URL(
  "../public/assets/objects/feral-walker-web.glb",
  import.meta.url,
);
const reportUrl = new URL(
  "../.cache/assets/feral-walker-web-report.json",
  import.meta.url,
);
const webpExtension = "EXT_texture_webp";
const EXPECTED_CLIPS = [
  "Idle",
  "Walk",
  "Walk_Grab",
  "Run",
  "Idle_Attack",
  "Roar",
  "HitReact",
  "Death",
];

function parseGlb(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, "Expected a GLB file");
  assert.equal(bytes.readUInt32LE(4), 2, "Expected GLB version 2");
  assert.equal(bytes.readUInt32LE(8), bytes.length, "Incorrect GLB length");
  let json;
  let bin;
  for (let offset = 12; offset < bytes.length; ) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(chunk.length, length, "Truncated GLB chunk");
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString());
    if (type === 0x004e4942) bin = chunk;
    offset += 8 + length;
  }
  assert.ok(json && bin, "Expected JSON and binary chunks");
  assert.equal(json.buffers.length, 1, "Only one embedded buffer is supported");
  return { json, bin };
}

function viewBytes(model, index) {
  const view = model.json.bufferViews[index];
  assert.equal(view.buffer, 0, "External buffers are not supported");
  return model.bin.subarray(
    view.byteOffset ?? 0,
    (view.byteOffset ?? 0) + view.byteLength,
  );
}

function encodeGlb(json, bin) {
  const rawJson = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc(Math.ceil(rawJson.length / 4) * 4, 0x20);
  rawJson.copy(jsonChunk);
  const result = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + bin.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonChunk.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(result, 20);
  const binHeader = 20 + jsonChunk.length;
  result.writeUInt32LE(bin.length, binHeader);
  result.writeUInt32LE(0x004e4942, binHeader + 4);
  bin.copy(result, binHeader + 8);
  return result;
}

function clipSummary(model) {
  return model.json.animations.map((animation) => ({
    name: animation.name,
    channels: animation.channels.length,
    duration: Math.max(
      ...animation.samplers.map((sampler) => {
        const accessor = model.json.accessors[sampler.input];
        assert.equal(
          accessor.componentType,
          5126,
          "Expected float animation times",
        );
        const view = model.json.bufferViews[accessor.bufferView];
        const bytes = viewBytes(model, accessor.bufferView);
        const stride = view.byteStride ?? 4;
        let end = 0;
        for (let index = 0; index < accessor.count; index++) {
          end = Math.max(
            end,
            bytes.readFloatLE((accessor.byteOffset ?? 0) + index * stride),
          );
        }
        return end;
      }),
    ),
  }));
}

function meshSummary(json) {
  const primitives = json.meshes.flatMap((mesh) => mesh.primitives);
  return {
    meshes: json.meshes.length,
    primitives: primitives.length,
    vertices: primitives.reduce(
      (sum, primitive) =>
        sum + json.accessors[primitive.attributes.POSITION].count,
      0,
    ),
    triangles: primitives.reduce(
      (sum, primitive) =>
        sum +
        json.accessors[primitive.indices ?? primitive.attributes.POSITION]
          .count /
          3,
      0,
    ),
    skins: json.skins.length,
    joints: json.skins.map((skin) => skin.joints.length),
  };
}

const originalBytes = await readFile(sourceUrl);
const source = parseGlb(originalBytes);
const json = structuredClone(source.json);
const colorImages = new Set();
for (const material of json.materials) {
  for (const texture of [
    material.pbrMetallicRoughness?.baseColorTexture,
    material.emissiveTexture,
  ]) {
    if (texture) colorImages.add(json.textures[texture.index].source);
  }
}

const replacements = new Map();
const textureReport = [];
for (const [index, image] of json.images.entries()) {
  const original = viewBytes(source, image.bufferView);
  const before = await sharp(original).metadata();
  const color = colorImages.has(index);
  const { data, info } = await sharp(original)
    .resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp(
      color
        ? { quality: 92, alphaQuality: 100, effort: 6 }
        : { lossless: true, effort: 6 },
    )
    .toBuffer({ resolveWithObject: true });
  replacements.set(image.bufferView, data);
  image.mimeType = "image/webp";
  textureReport.push({
    name: image.name,
    encoding: color ? "WebP quality 92" : "WebP lossless",
    before: {
      width: before.width,
      height: before.height,
      bytes: original.length,
    },
    after: { width: info.width, height: info.height, bytes: data.length },
  });
}

const chunks = [];
let offset = 0;
for (const [index, view] of json.bufferViews.entries()) {
  const data = replacements.get(index) ?? viewBytes(source, index);
  const padded = Buffer.alloc(Math.ceil(data.length / 4) * 4);
  data.copy(padded);
  view.byteOffset = offset;
  view.byteLength = data.length;
  chunks.push(padded);
  offset += padded.length;
}
const bin = Buffer.concat(chunks);
json.buffers[0].byteLength = bin.length;
for (const texture of json.textures) {
  texture.extensions = {
    ...texture.extensions,
    [webpExtension]: { source: texture.source },
  };
  delete texture.source;
}
json.extensionsUsed = [
  ...new Set([...(json.extensionsUsed ?? []), webpExtension]),
];
json.extensionsRequired = [
  ...new Set([...(json.extensionsRequired ?? []), webpExtension]),
];

const optimizedBytes = encodeGlb(json, bin);
const optimized = parseGlb(optimizedBytes);
for (const key of [
  "meshes",
  "accessors",
  "animations",
  "skins",
  "nodes",
  "scenes",
]) {
  assert.deepEqual(
    optimized.json[key],
    source.json[key],
    `${key} must remain unchanged`,
  );
}
for (const index of source.json.bufferViews.keys()) {
  if (!replacements.has(index)) {
    assert.ok(
      viewBytes(source, index).equals(viewBytes(optimized, index)),
      `Non-texture buffer view ${index} changed`,
    );
  }
}
const originalClips = clipSummary(source);
assert.deepEqual(
  originalClips.map((clip) => clip.name).sort(),
  [...EXPECTED_CLIPS].sort(),
  "Expected exactly the Feral Walker animation clips",
);
assert.deepEqual(
  clipSummary(optimized),
  originalClips,
  "Animation names/durations changed",
);
assert.deepEqual(
  meshSummary(optimized.json),
  meshSummary(source.json),
  "Geometry or rig counts changed",
);
for (const image of optimized.json.images) {
  const metadata = await sharp(
    viewBytes(optimized, image.bufferView),
  ).metadata();
  assert.equal(metadata.format, "webp");
  assert.ok(metadata.width <= 1024 && metadata.height <= 1024);
}

await writeFile(outputUrl, optimizedBytes);
assert.ok(
  (await readFile(outputUrl)).equals(optimizedBytes),
  "Companion GLB did not roundtrip",
);
assert.ok(
  (await readFile(sourceUrl)).equals(originalBytes),
  "The original GLB was modified",
);
const rgbaMemory = (side) =>
  textureReport.reduce(
    (sum, texture) => sum + texture[side].width * texture[side].height * 4,
    0,
  );
const report = {
  originalBytes: originalBytes.length,
  optimizedBytes: optimizedBytes.length,
  savedPercent: Number(
    ((1 - optimizedBytes.length / originalBytes.length) * 100).toFixed(2),
  ),
  originalSha256: createHash("sha256").update(originalBytes).digest("hex"),
  optimizedSha256: createHash("sha256").update(optimizedBytes).digest("hex"),
  originalTextureRgbaBytes: rgbaMemory("before"),
  optimizedTextureRgbaBytes: rgbaMemory("after"),
  geometryAndAnimationBuffersIdentical: true,
  mesh: meshSummary(json),
  clips: originalClips,
  textures: textureReport,
};
await mkdir(new URL(".", reportUrl), { recursive: true });
await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      originalBytes: report.originalBytes,
      optimizedBytes: report.optimizedBytes,
      savedPercent: report.savedPercent,
      originalTextureRgbaBytes: report.originalTextureRgbaBytes,
      optimizedTextureRgbaBytes: report.optimizedTextureRgbaBytes,
      clips: report.clips.length,
      mesh: report.mesh,
      reportPath: fileURLToPath(reportUrl),
    },
    null,
    2,
  ),
);
