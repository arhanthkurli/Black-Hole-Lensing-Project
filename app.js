const canvas = document.querySelector("#view");
const hasBakedOverview = Boolean(document.querySelector("#schwarzschild-explorer")?.dataset.renderer);
const blackHoleInput = document.querySelector("#show-black-hole");
const status = document.querySelector("#status");
const quadrantsButton = document.querySelector("#quadrants-mode");
const initialColorSource = quadrantsButton ? "quadrants" : "octants";
const initialColorLabel = quadrantsButton ? "Infinite four-color background" : "Eight-color sky at infinity";
const octantsButton = document.querySelector("#octants-mode");
const skyButton = document.querySelector("#sky-mode");
const gridButton = document.querySelector("#grid-mode");
const videoButton = document.querySelector("#video-mode");
const pictureButton = document.querySelector("#picture-mode");
const uploadButton = document.querySelector("#upload-button");
const downloadButton = document.querySelector("#download-button");
const uploadInput = document.querySelector("#image-upload");
const antialiasInput = document.querySelector("#antialias");
const camera = document.querySelector("#camera");
const schwarzschildButton = document.querySelector("#schwarzschild-mode");
const kerrButton = document.querySelector("#kerr-mode");
const highSpinButton = document.querySelector("#kerr-high-spin-mode");
const usesKerrStills = Boolean(kerrButton.dataset.kerrSpin);
const metricStatus = document.querySelector("#metric-status");
const overviewButton = document.querySelector("#overview-mode");
const refinedButton = document.querySelector("#refined-mode");
const usesSavedCloseups = refinedButton.dataset.savedCloseups === "true";
const leftButton = document.querySelector("#left-edge");
const rightButton = document.querySelector("#right-edge");
const refinementSelect = document.querySelector("#refinement-level");
const manifestStatus = document.querySelector("#manifest-status");
const retryRefinements = document.querySelector("#retry-refinements");
const MANIFEST_URL = "data/zooms/manifest.json";
const HIGH_SPIN_MANIFEST_URL = "data/kerr-a099/zooms/manifest.json";
const OVERVIEW = Object.freeze({ width: 640, height: 480, verticalFov: 60, stepQ: 2 * Math.tan(Math.PI / 6) / 480 });
const SCREEN_DISTANCE_M = 20; // Virtual focal distance. Screen X and Y are q_x and q_y times this scale.
const INITIAL_SELECTION = Object.freeze({ metric: "schwarzschild", view: "overview", side: "right", level: "modest" });
const METRICS = Object.freeze({
  schwarzschild: { file: "warp-map.json", name: "Schwarzschild", spin: 0, label: "Schwarzschild · a/M = 0", download: "schwarzschild-spin-0-lensing.png" },
  kerr: { file: "kerr-map.json", name: "Kerr", spin: 0.5, label: "Kerr · a/M = 0.5", download: "kerr-spin-0.5-lensing.png" },
  kerr099: { file: "data/kerr-a099/map.json", name: "Kerr", spin: 0.99, label: "Kerr · a/M = 0.99", download: "kerr-spin-0.99-lensing.png" },
});
const sourceControls = [quadrantsButton, octantsButton, skyButton, gridButton, videoButton, pictureButton, uploadButton].filter(Boolean);
const EMBEDDABLE_ASSETS = new Set([
  "warp-map.json", "warp-center.bin", "warp-samples.bin", "warp-samples.bin.gz", "warp-ranges.bin", "warp-status.bin",
  "kerr-map.json", "kerr-center.bin", "kerr-samples.bin", "kerr-samples.bin.gz", "kerr-ranges.bin", "kerr-status.bin",
  "source-milky-way.jpg", "source-grid.png", "source-quadrants.png",
]);

// The same renderer supports a folder or a generated, self-contained HTML file.
// Only the known bundled files can be redirected by the packaging hook.
function assetUrl(name) {
  const embedded = globalThis.LENSING_EMBEDDED_ASSETS;
  return EMBEDDABLE_ASSETS.has(name) && embedded && Object.prototype.hasOwnProperty.call(embedded, name) && typeof embedded[name] === "string"
    ? embedded[name]
    : name;
}

let gl;
let program;
let sourceTexture;
let cameraStream;
let animationFrame;
let cancelCameraReady;
let videoIsRunning = false;
let initialized = false;
let busy = false;
let disposed = false;
let generation = 0;
let hasAntialias = false;
let maxTextureSize = 0;
let antialiasDetail = "";
let mapGeneration = 0;
let mapLoading = false;
let requestedMetric = "schwarzschild";
let requestedSelection = { ...INITIAL_SELECTION };
let manifest;
let manifestLoading;
let manifestGeneration = 0;
let highRefinementError;
let activeMap;
let sourceKind = initialColorSource;
let startupPending;
let restartStartup = false;
let rendererLost = false;
const mapCache = new Map();
const settledMapKeys = new Set();
const MAX_CACHED_MAPS = 3;
const MAX_CACHED_BYTES = 128 * 1024 * 1024;
const cachedBundles = new Map();
const MAX_CONCURRENT_MAP_LOADS = 2;
let activeMapLoads = 0;
let queuedMapLoad;
function estimateBundleBytes(bundle, buffers = new Set(), arrays = new Set()) {
  let bytes = 0;
  const add = (value) => {
    if (ArrayBuffer.isView(value)) { if (!buffers.has(value.buffer)) { buffers.add(value.buffer); bytes += value.buffer.byteLength; } }
    else if (value instanceof ArrayBuffer) { if (!buffers.has(value)) { buffers.add(value); bytes += value.byteLength; } }
    // Overview JSON numeric arrays are estimated conservatively. This budget
    // does not claim to cover engine metadata, pending decodes or GPU memory.
    else if (Array.isArray(value) && !arrays.has(value)) { arrays.add(value); bytes += value.length * 16 + 64; }
  };
  for (const value of [bundle.map?.uv, bundle.antialias?.samples, bundle.antialias?.ranges, bundle.weights, bundle.quadrants?.centers, bundle.quadrants?.samples, bundle.quadrants?.pixels, bundle.octants?.pixels]) add(value);
  return bytes;
}
function cachedDecodedBytes() { const buffers = new Set(), arrays = new Set(); return [...cachedBundles.values()].reduce((sum, bundle) => sum + estimateBundleBytes(bundle, buffers, arrays), 0); }
function cancelQueuedMapLoad(keepKey) {
  if (queuedMapLoad && queuedMapLoad.key !== keepKey) {
    const cancelled = queuedMapLoad; queuedMapLoad = undefined;
    cancelled.reject(new Error("Map load superseded by newer navigation"));
  }
}
function startMapLoad(job) {
  activeMapLoads += 1;
  Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => {
    activeMapLoads -= 1;
    if (queuedMapLoad) { const next = queuedMapLoad; queuedMapLoad = undefined; startMapLoad(next); }
  });
}
function scheduleMapLoad(key, work) {
  return new Promise((resolve, reject) => {
    const job = { key, work, resolve, reject };
    if (activeMapLoads < MAX_CONCURRENT_MAP_LOADS) startMapLoad(job);
    else { cancelQueuedMapLoad(); queuedMapLoad = job; }
  });
}
// Data promises share in-flight requests. Keep at most three settled bundles
// after navigation, while pinning active/requested maps until an atomic swap.
function pruneMapCache() {
  const protectedKeys = new Set([activeMap?.key, selectionKey(requestedSelection)]);
  while (settledMapKeys.size > MAX_CACHED_MAPS || cachedDecodedBytes() > MAX_CACHED_BYTES) {
    const victim = [...mapCache.keys()].find((key) => settledMapKeys.has(key) && !protectedKeys.has(key));
    if (!victim) break; // In-flight requests are deduplicated until they settle.
    mapCache.delete(victim);
    settledMapKeys.delete(victim);
    cachedBundles.delete(victim);
  }
}
const MAX_SAMPLES = 512;
const MAX_LEGACY_SAMPLES = 256;

const vertexSource = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp isampler2D;
precision highp usampler2D;
uniform sampler2D uSource;
uniform sampler2D uWarp;
uniform sampler2D uSampleAtlas;
uniform isampler2D uSampleRanges;
uniform bool uUseAntialias;
uniform bool uUseQuadrants;
uniform bool uIdealFourColors;
uniform bool uEightOctants;
uniform bool uHasQuadrantLabels;
uniform bool uUseWeights;
uniform bool uUseQuadrantPixels;
uniform bool uUseOctantPixels;
uniform sampler2D uSampleWeights;
uniform sampler2D uQuadrantPixels;
uniform sampler2D uOctantPixels;
uniform highp usampler2D uQuadrantCenter;
uniform highp usampler2D uQuadrantAtlas;
uniform int uAtlasWidth;
uniform bool uPhotoPatch;
uniform float uSourceAspect;
uniform bool uUnlensedReference;
uniform vec4 uReferenceBounds;
out vec4 outColor;

vec4 quadrantColor(uint code);
vec4 octantColor(uint code);

vec4 sourceColor(vec2 uv, uint preciseQuadrant) {
  if (uv.x < 0.0 || uv.y < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  if (uEightOctants) {
    // nx=-cos(lat)*cos(lon), ny=cos(lat)*sin(lon), nz=sin(lat).
    // Both x hemispheres are included. No rays are selected by ring radius.
    uint code = (uv.x < 0.25 || uv.x >= 0.75 ? 4u : 0u)
              + (uv.x >= 0.5 ? 2u : 0u) + (uv.y >= 0.5 ? 1u : 0u);
    // Refined maps retain y/z signs from before Float32 UV rounding.
    // The x hemisphere still has the finite precision of the retained UV.
    if (uHasQuadrantLabels && preciseQuadrant >= 1u && preciseQuadrant <= 4u) {
      code = (code & 4u) + (preciseQuadrant == 2u || preciseQuadrant == 4u ? 2u : 0u)
                        + (preciseQuadrant <= 2u ? 1u : 0u);
    }
    return octantColor(code);
  }
  // The ideal sky is piecewise constant. Filtering its bitmap introduces a
  // finite angular transition, which lensing magnifies near axis/ring crossings.
  // Classify each ray first; screen-pixel AA still averages independent colors.
  // Refined maps use their pre-quantization quadrant codes instead of this UV
  // branch. Overview endpoints retain their existing finite UV precision.
  if (uIdealFourColors) {
    uint code = uv.y >= 0.5 ? (uv.x >= 0.5 ? 2u : 1u) : (uv.x >= 0.5 ? 4u : 3u);
    return quadrantColor(code);
  }
  if (uPhotoPatch) {
    float longitude = 6.283185307179586 * (uv.x - 0.5);
    float latitude = 3.141592653589793 * (uv.y - 0.5);
    float z = cos(latitude) * cos(longitude);
    // A 90-degree vertical field: tan(half field) = 1.
    vec3 outsidePhoto = vec3(37.0, 52.0, 72.0) / 255.0;
    if (z <= 0.0) return vec4(outsidePhoto, 1.0);
    vec2 photoUv = 0.5 + 0.5 * vec2(cos(latitude) * sin(longitude) / (uSourceAspect * z), sin(latitude) / z);
    if (any(lessThan(photoUv, vec2(0.0))) || any(greaterThan(photoUv, vec2(1.0)))) {
      return vec4(outsidePhoto, 1.0);
    }
    uv = photoUv;
  }
  // Sky longitude wraps in the source sampler, never in the ray-map texture.
  vec4 color = texture(uSource, uv);
  return vec4(color.rgb * color.a, 1.0);
}

vec4 quadrantColor(uint code) {
  if (code == 1u) return vec4(vec3(239.0, 68.0, 68.0) / 255.0, 1.0);
  if (code == 2u) return vec4(vec3(34.0, 197.0, 94.0) / 255.0, 1.0);
  if (code == 3u) return vec4(vec3(59.0, 130.0, 246.0) / 255.0, 1.0);
  if (code == 4u) return vec4(vec3(250.0, 204.0, 21.0) / 255.0, 1.0);
  return vec4(0.0, 0.0, 0.0, 1.0);
}

vec4 octantColor(uint code) {
  if (code == 0u) return vec4(vec3(59.0, 130.0, 246.0) / 255.0, 1.0);
  if (code == 1u) return vec4(vec3(239.0, 68.0, 68.0) / 255.0, 1.0);
  if (code == 2u) return vec4(vec3(250.0, 204.0, 21.0) / 255.0, 1.0);
  if (code == 3u) return vec4(vec3(34.0, 197.0, 94.0) / 255.0, 1.0);
  if (code == 4u) return vec4(vec3(151.0, 71.0, 255.0) / 255.0, 1.0);
  if (code == 5u) return vec4(vec3(255.0, 139.0, 38.0) / 255.0, 1.0);
  if (code == 6u) return vec4(vec3(255.0, 88.0, 171.0) / 255.0, 1.0);
  return vec4(vec3(20.0, 210.0, 220.0) / 255.0, 1.0);
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  if (uUnlensedReference) {
    vec2 fraction = gl_FragCoord.xy / vec2(textureSize(uWarp, 0));
    vec2 q = vec2(mix(uReferenceBounds.x, uReferenceBounds.y, fraction.x),
                  mix(uReferenceBounds.z, uReferenceBounds.w, fraction.y));
    vec3 direction = normalize(vec3(-1.0, q.x, q.y));
    vec2 uv = vec2(0.5 + atan(direction.y, -direction.x) / 6.283185307179586,
                   0.5 + asin(direction.z) / 3.141592653589793);
    outColor = sourceColor(uv, 0u);
    return;
  }
  if (uUseAntialias) {
    if (uUseOctantPixels) {
      outColor = vec4(texelFetch(uOctantPixels, pixel, 0).rgb, 1.0);
      return;
    }
    if (uUseQuadrantPixels) {
      // This fixed-source image integrates the geodesic color-boundary areas,
      // including capture. It is never used for another source or with AA off.
      outColor = vec4(texelFetch(uQuadrantPixels, pixel, 0).rgb, 1.0);
      return;
    }
    ivec2 range = texelFetch(uSampleRanges, pixel, 0).rg;
    if (uUseWeights) {
      vec3 weightedColor = vec3(0.0);
      for (int i = 0; i < ${MAX_SAMPLES}; ++i) {
        if (i >= range.y) break;
        int index = range.x + i;
        ivec2 samplePixel = ivec2(index % uAtlasWidth, index / uAtlasWidth);
        vec2 uv = texelFetch(uSampleAtlas, samplePixel, 0).rg;
        float weight = texelFetch(uSampleWeights, samplePixel, 0).r;
        uint code = uHasQuadrantLabels ? texelFetch(uQuadrantAtlas, samplePixel, 0).r : 0u;
        vec3 color = uUseQuadrants ? quadrantColor(code).rgb : sourceColor(uv, code).rgb;
        weightedColor += weight * color;
      }
      // Weights are areas of the WHOLE pixel. The omitted geometric capture
      // area is black: never renormalize by escaping area or sample count.
      outColor = vec4(weightedColor, 1.0);
      return;
    }
    if (range.y > 0) {
      vec4 sum = vec4(0.0);
      for (int i = 0; i < ${MAX_LEGACY_SAMPLES}; ++i) {
        if (i >= range.y) break;
        int index = range.x + i;
        vec2 uv = texelFetch(uSampleAtlas, ivec2(index % uAtlasWidth, index / uAtlasWidth), 0).rg;
        uint code = uHasQuadrantLabels ? texelFetch(uQuadrantAtlas, ivec2(index % uAtlasWidth, index / uAtlasWidth), 0).r : 0u;
        if (uUseQuadrants) sum += quadrantColor(code);
        else sum += sourceColor(uv, code);
      }
      // Average independently sampled COLORS. Averaging UVs corrupts seams,
      // winding branches, and the captured / escaping boundary.
      outColor = sum / float(range.y);
      return;
    }
  }
  uint code = uHasQuadrantLabels ? texelFetch(uQuadrantCenter, pixel, 0).r : 0u;
  outColor = uUseQuadrants ? quadrantColor(code) : sourceColor(texelFetch(uWarp, pixel, 0).rg, code);
}
`;

function setStatus(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function updateControls() {
  const disabled = !initialized || busy || disposed;
  const showingBakedOverview = hasBakedOverview && !initialized;
  for (const button of sourceControls) {
    button.disabled = showingBakedOverview && (button === octantsButton || button === skyButton) ? disposed : disabled;
  }
  downloadButton.disabled = showingBakedOverview ? disposed : disabled;
  blackHoleInput.disabled = (!initialized && !showingBakedOverview) || disposed;
  antialiasInput.disabled = disabled || !hasAntialias || !blackHoleInput.checked;
  // Metric buttons remain available during a map load: the newest request wins.
  if (usesKerrStills) schwarzschildButton.disabled = disposed;
  else for (const [id, button] of [["schwarzschild", schwarzschildButton], ["kerr", kerrButton], ["kerr099", highSpinButton]]) {
    button.disabled = !initialized || disposed;
    button.setAttribute("aria-pressed", String(activeMap?.id === id));
    button.setAttribute("aria-busy", String(mapLoading && requestedMetric === id));
  }
  if (!usesSavedCloseups) updateViewControls();
}

function updateViewControls() {
  const unavailable = !initialized || disposed;
  const current = activeMap?.selection || INITIAL_SELECTION;
  const metric = mapLoading ? requestedSelection.metric : current.metric;
  const hasRefinements = Boolean(manifest?.tiles.some(tile => tile.metric === metric));
  overviewButton.disabled = unavailable;
  refinedButton.disabled = unavailable || !manifest || !hasRefinements;
  overviewButton.setAttribute("aria-pressed", String(current.view === "overview"));
  refinedButton.setAttribute("aria-pressed", String(current.view === "refined"));
  overviewButton.setAttribute("aria-busy", String(mapLoading && requestedSelection.view === "overview"));
  refinedButton.setAttribute("aria-busy", String(mapLoading && requestedSelection.view === "refined"));
  // Edge and level choices are requests, not measurements of the visible map.
  // They remain usable while loading so a newer navigation can supersede it.
  for (const [side, button] of [["left", leftButton], ["right", rightButton]]) {
    button.disabled = unavailable || !manifest || !hasRefinements;
    button.setAttribute("aria-pressed", String(current.side === side));
    button.setAttribute("aria-busy", String(mapLoading && requestedSelection.view === "refined" && requestedSelection.side === side));
  }
  refinementSelect.disabled = unavailable || !manifest || !hasRefinements;
  refinementSelect.value = mapLoading ? requestedSelection.level : current.level;
  const side = mapLoading ? requestedSelection.side : current.side;
  for (const [level, label] of [["modest", "Wide"], ["deep", "Narrow"]]) {
    const tile = tileFor({ metric, side, level });
    document.querySelector(`#patch-${level}`).textContent = tile ? `${label} · ${screenSize(tile)}` : label;
  }
  document.querySelector("#left-edge-label").textContent = METRICS[metric].spin > 0 ? "Prograde photon" : "";
  document.querySelector("#right-edge-label").textContent = METRICS[metric].spin > 0 ? "Retrograde photon" : "";
}

function isCurrent(token) {
  return token === generation && !disposed;
}

// One source transition at a time. The token also invalidates unresolved camera
// permission prompts when the page is left, so their eventual streams are stopped.
async function runOperation(errorPrefix, action) {
  if (!initialized || busy || disposed) return;
  busy = true;
  const token = ++generation;
  updateControls();
  try {
    await action(token);
  } catch (error) {
    if (isCurrent(token)) {
      closeCamera();
      setStatus(`${errorPrefix}: ${error.message}`, true);
    }
  } finally {
    if (isCurrent(token)) {
      busy = false;
      updateControls();
    }
  }
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validateUvPairs(values, label) {
  for (let i = 0; i < values.length; i += 2) {
    const u = values[i];
    const v = values[i + 1];
    if (typeof u !== "number" || typeof v !== "number" || !Number.isFinite(u) || !Number.isFinite(v)) {
      throw new Error(`${label} contains a non-finite or nonnumeric UV at pixel ${i / 2}`);
    }
    if (u === -1 && v === -1) continue;
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      throw new Error(`${label} UV at pixel ${i / 2} must be in [0,1] or exactly [-1,-1]`);
    }
  }
}

function validateMap(map, reconstructUv = false) {
  if (!map || map.format !== "uv-map-v1") throw new Error(`Unsupported map format: ${map?.format}`);
  if (!positiveInteger(map.width) || !positiveInteger(map.height) || !Number.isSafeInteger(map.width * map.height * 2)) {
    throw new Error("Map width and height must be positive, safe integers");
  }
  if (!reconstructUv && (!(Array.isArray(map.uv) || map.uv instanceof Float32Array) || map.uv.length !== map.width * map.height * 2)) {
    throw new Error("Map UV data has the wrong length or is not an array");
  }
  if (map.invalid_uv !== undefined && (!Array.isArray(map.invalid_uv) || map.invalid_uv.length !== 2 || map.invalid_uv[0] !== -1 || map.invalid_uv[1] !== -1)) {
    throw new Error("Map invalid_uv must be exactly [-1,-1]");
  }
  if (!reconstructUv) validateUvPairs(map.uv, "Map");
  if (map.antialias !== undefined) {
    const aa = map.antialias;
    if (!aa || aa.format !== "uv-samples-v1" || aa.byte_order !== "little-endian") {
      throw new Error("Unsupported antialias format or byte order");
    }
    if (!positiveInteger(aa.atlas_width) || !positiveInteger(aa.atlas_height) || !Number.isSafeInteger(aa.atlas_width * aa.atlas_height * 8)) {
      throw new Error("Antialias atlas dimensions must be positive, safe integers");
    }
    validateSampleEncoding(aa.samples_encoding);
    const sampleLimit = aa.weights ? MAX_SAMPLES : MAX_LEGACY_SAMPLES;
    if (!positiveInteger(aa.max_samples) || aa.max_samples > sampleLimit) {
      throw new Error(`Antialias max_samples must be between 1 and ${sampleLimit}`);
    }
    for (const key of ["samples_url", "ranges_url"]) {
      if (!isScopedAsset(aa[key])) {
        throw new Error(`Antialias ${key} must be a scoped relative asset path`);
      }
    }
  }
}

function validateSampleEncoding(encoding) {
  if (encoding === undefined) return;
  if (!encoding || typeof encoding !== "object" || encoding.format !== "byte-plane-shuffle-v1" || encoding.item_bytes !== 8) throw new Error("Unsupported sample transport encoding");
}
function decodeSamplePairs(buffer, capacity, encoding) {
  validateSampleEncoding(encoding);
  if (!positiveInteger(capacity) || !Number.isSafeInteger(capacity * 8) || buffer.byteLength !== capacity * 8) throw new Error("Antialias samples have the wrong byte length");
  const samples = new Float32Array(capacity * 2);
  if (encoding === undefined) {
    const view = new DataView(buffer);
    for (let i = 0; i < samples.length; i += 1) samples[i] = view.getFloat32(i * 4, true);
  } else {
    // Decode straight into the retained Float32 buffer, avoiding another large
    // staging allocation. A big-endian host gets byte-swapped float words.
    const littleEndianHost = new Uint8Array(new Float32Array([1]).buffer)[0] === 0;
    const input = new Uint8Array(buffer), output = new Uint8Array(samples.buffer);
    for (let byte = 0; byte < 8; byte += 1) {
      const hostByte = littleEndianHost ? byte : 4 * Math.floor(byte / 4) + 3 - (byte % 4);
      for (let item = 0; item < capacity; item += 1) output[item * 8 + hostByte] = input[byte * capacity + item];
    }
  }
  return samples;
}

function decodeAntialias(map, samplesBuffer, rangesBuffer) {
  const aa = map.antialias;
  const capacity = aa.atlas_width * aa.atlas_height;
  if (samplesBuffer.byteLength !== capacity * 8) throw new Error("Antialias samples have the wrong byte length");
  if (rangesBuffer.byteLength !== map.width * map.height * 8) throw new Error("Antialias ranges have the wrong byte length");
  // Explicit decoding makes the little-endian on-disk contract independent of
  // the host machine's typed-array byte order.
  const samples = samplesBuffer instanceof Float32Array
    ? samplesBuffer : decodeSamplePairs(samplesBuffer, capacity, aa.samples_encoding);
  validateUvPairs(samples, "Antialias atlas");
  const rangeView = new DataView(rangesBuffer);
  const ranges = new Int32Array(map.width * map.height * 2);
  let selectedPixels = 0;
  let totalSamples = 0;
  for (let i = 0; i < ranges.length; i += 2) {
    const start = rangeView.getInt32(i * 4, true);
    const count = rangeView.getInt32((i + 1) * 4, true);
    if (start < 0 || count < 0 || count > aa.max_samples || start + count > capacity) {
      throw new Error(`Antialias range at pixel ${i / 2} is out of bounds`);
    }
    ranges[i] = start;
    ranges[i + 1] = count;
    if (count > 1) selectedPixels += 1;
    totalSamples += count;
  }
  return { samples, ranges, selectedPixels, totalSamples };
}

function decodeFloat32Values(buffer, length, label) {
  if (buffer.byteLength !== length * 4) throw new Error(`${label} has the wrong byte length`);
  const data = new Float32Array(length), view = new DataView(buffer);
  for (let i = 0; i < length; i += 1) data[i] = view.getFloat32(i * 4, true);
  return data;
}

function decodePixelWeights(map, antialias, buffer) {
  const capacity = map.antialias.atlas_width * map.antialias.atlas_height;
  const weights = decodeFloat32Values(buffer, capacity, "Pixel-area weights");
  const used = new Uint8Array(Math.ceil(capacity / 8));
  for (let j = 0; j < capacity; j += 1) if (!Number.isFinite(weights[j]) || weights[j] < 0 || weights[j] > 1) throw new Error(`Invalid pixel-area weight at subray ${j}`);
  for (let i = 0; i < antialias.ranges.length; i += 2) {
    const start = antialias.ranges[i], count = antialias.ranges[i + 1];
    if (count === 0) throw new Error(`Weighted pixel ${i / 2} must have a nonempty sample range`);
    let total = 0;
    for (let offset = 0; offset < count; offset += 1) {
      const j = start + offset, weight = weights[j];
      if (!(weight > 0)) throw new Error(`Referenced pixel-area weight must be positive at subray ${j}`);
      if (antialias.samples[j * 2] === -1 && (count !== 1 || weight !== 1 || map.uv[i] !== -1)) throw new Error(`Captured weighted pixel ${i / 2} must use one unit-weight capture sentinel`);
      used[j >> 3] |= 1 << (j & 7);
      total += weight;
    }
    if (total > 1 + 2e-6) throw new Error(`Pixel-area weights exceed a whole pixel at pixel ${i / 2}`);
  }
  for (let j = 0; j < capacity; j += 1) if (!(used[j >> 3] & (1 << (j & 7))) && weights[j] !== 0) throw new Error(`Unused pixel-area weight must be zero at subray ${j}`);
  return weights;
}

function isScopedAsset(name) {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) && !name.split("/").some((part) => !part || part === "." || part === "..");
}

async function fetchRequired(url, binary = false) {
  const packed = EMBEDDABLE_ASSETS.has(url) && globalThis.LENSING_EMBEDDED_ASSETS?.[url];
  if (packed && typeof packed === "object") {
    if (packed.encoding !== "gzip" || typeof packed.base64 !== "string" || !Number.isSafeInteger(packed.bytes) || packed.bytes < 1) {
      throw new Error(`Invalid bundled asset: ${url}`);
    }
    if (typeof DecompressionStream !== "function") throw new Error("This standalone file needs a modern browser with gzip decompression support; use the uncompressed folder version instead");
    const compressed = Uint8Array.from(atob(packed.base64), (character) => character.charCodeAt(0));
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
    let data = await new Response(stream).arrayBuffer();
    if (data.byteLength !== packed.bytes) throw new Error(`Bundled asset length mismatch: ${url}`);
    if (packed.byte_shuffle !== undefined) {
      if (packed.byte_shuffle !== 4 || data.byteLength % 4) throw new Error(`Invalid byte-shuffled asset: ${url}`);
      const input = new Uint8Array(data);
      const output = new Uint8Array(data.byteLength);
      const words = input.length / 4;
      for (let part = 0; part < 4; part += 1) {
        for (let word = 0; word < words; word += 1) output[word * 4 + part] = input[part * words + word];
      }
      data = output.buffer;
    }
    return binary === "text" ? new TextDecoder().decode(data) : binary ? data : JSON.parse(new TextDecoder().decode(data));
  }
  const response = await fetch(assetUrl(url));
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  if (url.endsWith(".gz")) {
    const compressed = await response.arrayBuffer();
    // Static hosting normally serves .gz as a file, but a server may also send
    // Content-Encoding:gzip. Fetch then decodes it before this code sees it.
    const bytes = new Uint8Array(compressed);
    const gzipEncoded = bytes.length >= 10 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 8 && (bytes[3] & 0xe0) === 0;
    if (gzipEncoded && typeof DecompressionStream !== "function") throw new Error("This view needs gzip decompression support in a modern browser");
    const data = gzipEncoded
      ? await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
      : compressed;
    return binary === "text" ? new TextDecoder().decode(data) : binary ? data : JSON.parse(new TextDecoder().decode(data));
  }
  return binary === "text" ? response.text() : binary ? response.arrayBuffer() : response.json();
}

async function loadMapBundle(id, tile = null) {
  if (!METRICS[id]) throw new Error("Unknown spacetime selection");
  const cacheKey = tile ? `tile:${tile.id}` : id;
  if (mapCache.has(cacheKey)) {
    const cached = mapCache.get(cacheKey);
    mapCache.delete(cacheKey); mapCache.set(cacheKey, cached);
    return cached;
  }
  const loading = scheduleMapLoad(cacheKey, async () => {
    const map = { ...await fetchRequired(tile ? tile.map_url : METRICS[id].file) };
    const reconstructUv = Boolean(tile?.radial_phase_url);
    // Refined tiles and compact packages use lossless binary center pairs.
    // Decode explicitly little-endian before uploading exact Float32 texels.
    if (map.uv_binary !== undefined && !reconstructUv) {
      const spec = map.uv_binary;
      if (map.uv !== undefined || !spec || spec.format !== "float32-pairs-v1" || spec.byte_order !== "little-endian" || !isScopedAsset(spec.url)) throw new Error("Invalid binary center-UV descriptor");
      if (!positiveInteger(map.width) || !positiveInteger(map.height) || !Number.isSafeInteger(map.width * map.height * 8)) throw new Error("Invalid binary center-UV dimensions");
      const buffer = await fetchRequired(spec.url, true);
      if (buffer.byteLength !== map.width * map.height * 8) throw new Error("Center UV data has the wrong byte length");
      const view = new DataView(buffer);
      map.uv = new Float32Array(map.width * map.height * 2);
      for (let i = 0; i < map.uv.length; i += 1) map.uv[i] = view.getFloat32(i * 4, true);
    }
    validateMap(map, reconstructUv);
    if (tile) {
      if (map.width !== tile.width || map.height !== tile.height) throw new Error("Tile dimensions disagree with its manifest");
      const patch = map.geometry?.camera_patch;
      if (!patch) throw new Error("Refined map is missing camera-patch metadata");
      for (const key of ["id", "metric", "spin", "side", "level", "width", "height", "frame", "linear_zoom"]) if (patch[key] !== tile[key]) throw new Error(`Map and manifest disagree on ${key}`);
      for (const key of ["bounds_qx", "bounds_qy", "critical_point_q", "pixel_step_q"]) {
        if (!Array.isArray(patch[key]) || patch[key].length !== 2 || patch[key].some((value, i) => value !== tile[key][i])) throw new Error(`Map and manifest disagree on ${key}`);
      }
      if (!map.status || !map.antialias?.sample_status_url) throw new Error("Refined map is missing resolved-ray status data");
    }
    if (map.geometry?.metric !== METRICS[id].name) throw new Error(`Expected ${METRICS[id].name} geometry`);
    const spin = map.geometry.spin_parameter_a_over_M;
    if (spin !== undefined && spin !== METRICS[id].spin) throw new Error("Map spin does not match the selected spacetime");
    if (map.width > maxTextureSize || map.height > maxTextureSize) throw new Error(`Ray map exceeds this GPU's ${maxTextureSize}-pixel texture limit`);
    if (map.antialias && (map.antialias.atlas_width > maxTextureSize || map.antialias.atlas_height > maxTextureSize)) throw new Error(`Antialias atlas exceeds this GPU's ${maxTextureSize}-pixel texture limit`);
    let antialias;
    if (map.antialias) {
      const rangeData = fetchRequired(map.antialias.ranges_url, true);
      let samples, ranges;
      if (reconstructUv) {
        ranges = await rangeData;
        const radial = await loadRadialCoordinates(tile, map.antialias, ranges);
        map.uv = radial.centers;
        validateUvPairs(map.uv, "Radial center map");
        samples = radial.samples;
      } else {
        [samples, ranges] = await Promise.all([fetchRequired(map.antialias.samples_url, true), rangeData]);
      }
      antialias = decodeAntialias(map, samples, ranges);
      if (map.antialias.sample_status_url !== undefined) {
        if (!isScopedAsset(map.antialias.sample_status_url)) throw new Error("Invalid subray-status asset path");
        const statuses = new Uint8Array(await fetchRequired(map.antialias.sample_status_url, true));
        if (statuses.length !== map.antialias.atlas_width * map.antialias.atlas_height) throw new Error("Subray status has the wrong byte length");
        for (let i = 0; i < antialias.ranges.length; i += 2) {
          const start = antialias.ranges[i], count = antialias.ranges[i + 1];
          for (let offset = 0; offset < count; offset += 1) {
            const j = start + offset;
            if (statuses[j] > 1 || (statuses[j] === 0) !== (antialias.samples[j * 2] === -1)) throw new Error(`Unresolved or inconsistent status at subray ${j}`);
          }
        }
      }
    }
    if (map.status !== undefined) {
      if (!isScopedAsset(map.status?.url)) throw new Error("Invalid ray-status asset path");
      const bytes = new Uint8Array(await fetchRequired(map.status.url, true));
      if (bytes.length !== map.width * map.height) throw new Error("Ray status has the wrong byte length");
      for (let i = 0; i < bytes.length; i += 1) {
        if (bytes[i] > 1) throw new Error(`Ray status ${bytes[i]} at pixel ${i} is not a resolved captured/escaped ray`);
        if ((bytes[i] === 0) !== (map.uv[i * 2] === -1)) throw new Error(`Ray status and UV disagree at pixel ${i}`);
      }
    }
    let weights;
    if (map.antialias?.weights !== undefined) {
      const spec = map.antialias.weights;
      if (!spec || spec.format !== "pixel-area-weights-v1" || spec.byte_order !== "little-endian" || spec.residual !== "captured-black" || !isScopedAsset(spec.url)) throw new Error("Invalid pixel-area weight descriptor");
      weights = decodePixelWeights(map, antialias, await fetchRequired(spec.url, true));
    }
    let quadrants;
    if (map.quadrants !== undefined) {
      const spec = map.quadrants;
      if (!spec || spec.format !== "quadrant-codes-v1" || !isScopedAsset(spec.center_url) || !isScopedAsset(spec.samples_url) || !antialias) throw new Error("Invalid exact-quadrant descriptor");
      // quadrant-codes-v1 is a fixed source, not a user-defined palette. If the
      // producer also publishes human-readable metadata, it must agree.
      const codeNames = { 0: "captured", 1: "red", 2: "green", 3: "blue", 4: "yellow", 255: "invalid" };
      const palette = { 1: [239, 68, 68], 2: [34, 197, 94], 3: [59, 130, 246], 4: [250, 204, 21] };
      if (spec.codes !== undefined && (!spec.codes || Object.entries(codeNames).some(([key, value]) => spec.codes[key] !== value))) throw new Error("Exact-quadrant code names disagree with the fixed source");
      if (spec.rgb !== undefined && (!spec.rgb || Object.entries(palette).some(([key, values]) => !Array.isArray(spec.rgb[key]) || spec.rgb[key].length !== 3 || spec.rgb[key].some((value, i) => value !== values[i])))) throw new Error("Exact-quadrant palette disagrees with the fixed source");
      const [centerBuffer, sampleBuffer] = await Promise.all([fetchRequired(spec.center_url, true), fetchRequired(spec.samples_url, true)]);
      const centers = new Uint8Array(centerBuffer), samples = new Uint8Array(sampleBuffer);
      if (centers.length !== map.width * map.height || samples.length !== map.antialias.atlas_width * map.antialias.atlas_height) throw new Error("Exact-quadrant data has the wrong byte length");
      for (let i = 0; i < centers.length; i += 1) {
        if (centers[i] > 4 || (centers[i] === 0) !== (map.uv[i * 2] === -1)) throw new Error(`Invalid or inconsistent center quadrant at pixel ${i}`);
      }
      for (let i = 0; i < samples.length; i += 1) if (samples[i] > 4 && samples[i] !== 255) throw new Error(`Invalid quadrant code at subray ${i}`);
      for (let i = 0; i < antialias.ranges.length; i += 2) {
        const start = antialias.ranges[i], count = antialias.ranges[i + 1];
        for (let offset = 0; offset < count; offset += 1) {
          const j = start + offset;
          if (samples[j] > 4 || (samples[j] === 0) !== (antialias.samples[j * 2] === -1)) throw new Error(`Invalid or inconsistent quadrant at subray ${j}`);
        }
      }
      quadrants = { centers, samples };
      if (quadrantsButton && spec.pixel_rgb !== undefined) {
        const pixelSpec = spec.pixel_rgb;
        if (!pixelSpec || pixelSpec.format !== "rgba32f-pixels-v1" || pixelSpec.byte_order !== "little-endian" || pixelSpec.includes_capture !== true || pixelSpec.encoding !== "source-srgb" || !isScopedAsset(pixelSpec.url)) throw new Error("Invalid integrated four-color pixel descriptor");
        const pixels = decodeFloat32Values(await fetchRequired(pixelSpec.url, true), map.width * map.height * 4, "Integrated four-color pixels");
        for (let i = 0; i < pixels.length; i += 1) {
          if (!Number.isFinite(pixels[i]) || pixels[i] < 0 || pixels[i] > 1 || (i % 4 === 3 && pixels[i] !== 1)) throw new Error(`Invalid integrated four-color channel at index ${i}`);
        }
        if (weights) {
          for (let i = 0; i < antialias.ranges.length; i += 2) {
            const start = antialias.ranges[i], count = antialias.ranges[i + 1];
            const pixelOffset = i * 2;
            if (count === 1 && antialias.samples[start * 2] === -1 && (pixels[pixelOffset] !== 0 || pixels[pixelOffset + 1] !== 0 || pixels[pixelOffset + 2] !== 0)) throw new Error(`Integrated color must be black for wholly captured pixel ${i / 2}`);
          }
        }
        quadrants.pixels = pixels;
      }
    }
    let octants;
    if (map.octants !== undefined) {
      const spec = map.octants;
      const pixelSpec = spec?.pixel_rgb;
      if (spec?.format !== "octant-areas-v1" || !pixelSpec || pixelSpec.format !== "rgba32f-pixels-v1" || pixelSpec.byte_order !== "little-endian" || pixelSpec.includes_capture !== true || pixelSpec.encoding !== "source-srgb" || !isScopedAsset(pixelSpec.url)) throw new Error("Invalid integrated eight-color pixel descriptor");
      const pixels = decodeFloat32Values(await fetchRequired(pixelSpec.url, true), map.width * map.height * 4, "Integrated eight-color pixels");
      for (let i = 0; i < pixels.length; i += 1) {
        if (!Number.isFinite(pixels[i]) || pixels[i] < 0 || pixels[i] > 1 || (i % 4 === 3 && pixels[i] !== 1)) throw new Error(`Invalid integrated eight-color channel at index ${i}`);
      }
      if (weights) for (let i = 0; i < antialias.ranges.length; i += 2) {
        const start = antialias.ranges[i], count = antialias.ranges[i + 1], p = i * 2;
        if (count === 1 && antialias.samples[start * 2] === -1 && (pixels[p] !== 0 || pixels[p + 1] !== 0 || pixels[p + 2] !== 0)) throw new Error(`Integrated octants must be black for wholly captured pixel ${i / 2}`);
      }
      octants = { pixels };
    }
    return { id, map, antialias, quadrants, octants, weights, tile, key: cacheKey };
  });
  mapCache.set(cacheKey, loading);
  try {
    const bundle = await loading;
    if (mapCache.get(cacheKey) === loading) { settledMapKeys.add(cacheKey); cachedBundles.set(cacheKey, bundle); pruneMapCache(); }
    return bundle;
  } catch (error) {
    if (mapCache.get(cacheKey) === loading) { mapCache.delete(cacheKey); settledMapKeys.delete(cacheKey); cachedBundles.delete(cacheKey); }
    throw error;
  }
}

async function loadRadialCoordinates(tile, atlas, ranges) {
  if (!isScopedAsset(atlas.quadrature_rule_url)) throw new Error("Missing Schwarzschild quadrature rule");
  const [table, rule] = await Promise.all([
    fetchRequired(tile.radial_phase_url),
    fetchRequired(atlas.quadrature_rule_url),
  ]);
  if (!isScopedAsset(rule?.normal_count_url)) throw new Error("Missing Schwarzschild normal sample counts");
  const normals = await fetchRequired(rule.normal_count_url, true);
  return new Promise((resolve, reject) => {
    const worker = new Worker("radial-refinement.js", { type: "module" });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Could not reconstruct Schwarzschild close-up"));
    };
    worker.postMessage({ tile, atlas, table, rule, normals, ranges }, [normals]);
  });
}

function bindMap(bundle) {
  const halfX = OVERVIEW.width * OVERVIEW.stepQ / 2;
  const halfY = OVERVIEW.height * OVERVIEW.stepQ / 2;
  const boundsX = bundle.tile?.bounds_qx || [-halfX, halfX];
  const boundsY = bundle.tile?.bounds_qy || [-halfY, halfY];
  gl.uniform4f(gl.getUniformLocation(program, "uReferenceBounds"), boundsX[0], boundsX[1], boundsY[0], boundsY[1]);
  for (let i = 0; i < bundle.textures.length; i += 1) {
    gl.activeTexture(gl.TEXTURE0 + i + 1);
    gl.bindTexture(gl.TEXTURE_2D, bundle.textures[i]);
  }
  // Every active sampler must have a complete texture, including maps without
  // eight-color pixel areas. Reuse the four-color/dummy pixel texture there.
  gl.activeTexture(gl.TEXTURE0 + 8);
  gl.bindTexture(gl.TEXTURE_2D, bundle.octants ? bundle.textures[7] : bundle.textures[6]);
  gl.uniform1i(gl.getUniformLocation(program, "uAtlasWidth"), bundle.antialias ? bundle.map.antialias.atlas_width : 1);
  gl.uniform1i(gl.getUniformLocation(program, "uUseAntialias"), Number(Boolean(bundle.antialias) && antialiasInput.checked));
  gl.uniform1i(gl.getUniformLocation(program, "uUseQuadrants"), Number(sourceKind === "quadrants" && Boolean(bundle.quadrants)));
  gl.uniform1i(gl.getUniformLocation(program, "uIdealFourColors"), Number(sourceKind === "quadrants"));
  gl.uniform1i(gl.getUniformLocation(program, "uEightOctants"), Number(sourceKind === "octants"));
  gl.uniform1i(gl.getUniformLocation(program, "uHasQuadrantLabels"), Number(Boolean(bundle.quadrants)));
  gl.uniform1i(gl.getUniformLocation(program, "uUseWeights"), Number(Boolean(bundle.weights)));
  gl.uniform1i(gl.getUniformLocation(program, "uUseQuadrantPixels"), Number(sourceKind === "quadrants" && Boolean(bundle.quadrants?.pixels)));
  gl.uniform1i(gl.getUniformLocation(program, "uUseOctantPixels"), Number(sourceKind === "octants" && Boolean(bundle.octants?.pixels)));
}

function commitMap(bundle, render = true) {
  if (activeMap && (bundle.map.width !== activeMap.map.width || bundle.map.height !== activeMap.map.height)) throw new Error("Both spacetime maps must use the same camera dimensions");
  const next = { ...bundle, selection: bundle.selection || { ...INITIAL_SELECTION, metric: bundle.id }, textures: [] };
  const { map, antialias } = bundle;
  try {
    next.textures.push(uploadDataTexture(1, map.width, map.height, new Float32Array(map.uv)));
    next.textures.push(uploadDataTexture(2, antialias ? map.antialias.atlas_width : 1, antialias ? map.antialias.atlas_height : 1, antialias ? antialias.samples : new Float32Array([-1, -1])));
    next.textures.push(uploadDataTexture(3, antialias ? map.width : 1, antialias ? map.height : 1, antialias ? antialias.ranges : new Int32Array([0, 0]), true));
    next.textures.push(uploadCodeTexture(4, bundle.quadrants ? map.width : 1, bundle.quadrants ? map.height : 1, bundle.quadrants ? bundle.quadrants.centers : new Uint8Array([0])));
    next.textures.push(uploadCodeTexture(5, bundle.quadrants ? map.antialias.atlas_width : 1, bundle.quadrants ? map.antialias.atlas_height : 1, bundle.quadrants ? bundle.quadrants.samples : new Uint8Array([0])));
    next.textures.push(uploadScalarTexture(6, bundle.weights ? map.antialias.atlas_width : 1, bundle.weights ? map.antialias.atlas_height : 1, bundle.weights || new Float32Array([0])));
    next.textures.push(uploadScalarTexture(7, bundle.quadrants?.pixels ? map.width : 1, bundle.quadrants?.pixels ? map.height : 1, bundle.quadrants?.pixels || new Float32Array([0, 0, 0, 1]), true));
    if (bundle.octants) next.textures.push(uploadScalarTexture(8, map.width, map.height, bundle.octants.pixels, true));
    bindMap(next);
    if (render) drawFrame();
  } catch (error) {
    // Texture uploads alter bindings. Restore every old map binding before any
    // camera frame can draw, so a failed swap never produces a mixed ray map.
    if (activeMap) bindMap(activeMap);
    for (const texture of next.textures) gl.deleteTexture(texture);
    throw error;
  }
  const previous = activeMap;
  activeMap = next;
  hasAntialias = Boolean(antialias);
  if (!hasAntialias) antialiasInput.checked = false;
  showGeometry(map, antialias);
  describeMainView();
  document.querySelector("#active-metric").textContent = METRICS[bundle.id].label;
  showViewContext(next);
  updateSourceDescription();
  if (previous) for (const texture of previous.textures) gl.deleteTexture(texture);
  pruneMapCache();
}

function validateManifest(candidate, requiredMetrics = ["schwarzschild", "kerr"]) {
  if (!candidate || candidate.format !== "critical-tiles-v1" || !Array.isArray(candidate.tiles) || !candidate.tiles.length) throw new Error("Unsupported or empty refined-view manifest");
  const ids = new Set();
  const choices = new Set();
  const validPair = (pair) => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite);
  for (const tile of candidate.tiles) {
    if (!tile || typeof tile.id !== "string" || !/^[a-z0-9-]+$/.test(tile.id) || ids.has(tile.id)) throw new Error("Invalid or duplicate refined-view ID");
    if (!METRICS[tile.metric] || METRICS[tile.metric].spin !== tile.spin || !["left", "right"].includes(tile.side) || !["modest", "deep"].includes(tile.level)) throw new Error("Invalid refined-view metric, side, or level");
    const choice = `${tile.metric}:${tile.side}:${tile.level}`;
    if (choices.has(choice)) throw new Error("Duplicate refined-view selection");
    if (tile.frame !== "offset-from-own-critical-point") throw new Error("Unknown refinement comparison frame");
    if (!isScopedAsset(tile.map_url) || !positiveInteger(tile.width) || !positiveInteger(tile.height)) throw new Error("Invalid refined-view file or dimensions");
    if (tile.radial_phase_url !== undefined && (tile.spin !== 0 || !isScopedAsset(tile.radial_phase_url))) throw new Error("Invalid Schwarzschild radial phase asset");
    for (const key of ["bounds_qx", "bounds_qy"]) if (!validPair(tile[key]) || tile[key][0] >= tile[key][1]) throw new Error("Invalid refined-view bounds");
    if (!validPair(tile.critical_point_q) || tile.critical_point_q[0] < tile.bounds_qx[0] || tile.critical_point_q[0] > tile.bounds_qx[1] || tile.critical_point_q[1] < tile.bounds_qy[0] || tile.critical_point_q[1] > tile.bounds_qy[1]) throw new Error("Critical point must lie within the tile");
    if (!validPair(tile.pixel_step_q) || tile.pixel_step_q.some((x) => x <= 0) || !Number.isFinite(tile.linear_zoom) || tile.linear_zoom <= 1) throw new Error("Invalid refinement scale");
    if (!validPair(tile.overview_pixels_per_tile) || tile.overview_pixels_per_tile.some((x) => x <= 0)) throw new Error("Invalid overview-pixel span");
    const extents = [tile.bounds_qx[1] - tile.bounds_qx[0], tile.bounds_qy[1] - tile.bounds_qy[0]];
    const dimensions = [tile.width, tile.height];
    for (let axis = 0; axis < 2; axis += 1) {
      const matches = (a, b) => Math.abs(a - b) <= 1e-8 * Math.max(Math.abs(a), Math.abs(b), 1e-15);
      if (!matches(tile.pixel_step_q[axis] * dimensions[axis], extents[axis]) || !matches(tile.overview_pixels_per_tile[axis] * OVERVIEW.stepQ, extents[axis]) || !matches(tile.pixel_step_q[axis] * tile.linear_zoom, OVERVIEW.stepQ)) throw new Error("Refinement scale and bounds disagree");
    }
    ids.add(tile.id); choices.add(choice);
  }
  // Both metrics, both sides and both levels must be real assets, not fallbacks.
  for (const metric of requiredMetrics) for (const side of ["left", "right"]) for (const level of ["modest", "deep"]) {
    if (!choices.has(`${metric}:${side}:${level}`)) throw new Error("The refined-view manifest is incomplete");
  }
  return candidate;
}

async function loadRefinements() {
  if (manifestLoading) return manifestLoading;
  const token = ++manifestGeneration;
  retryRefinements.hidden = true;
  manifestStatus.textContent = "Checking available refined views…";
  manifestStatus.dataset.error = "false";
  const loading = (async () => {
    try {
      const saved = await fetchRequired(MANIFEST_URL);
      // The source checkout also keeps the full research manifest.
      const baseline = usesKerrStills
        ? validateManifest({ ...saved, tiles: saved.tiles.filter((tile) => tile.metric === "schwarzschild") }, ["schwarzschild"])
        : validateManifest(saved);
      let candidate = baseline;
      highRefinementError = undefined;
      // Keep the original manifest intact. An unavailable optional high-spin
      // generation leaves all established views usable.
      try {
        if (!usesKerrStills) {
          const extra = validateManifest(await fetchRequired(HIGH_SPIN_MANIFEST_URL), ["kerr099"]);
          if (extra.tiles.length !== 4 || extra.tiles.some(tile => tile.metric !== "kerr099")) throw new Error("Invalid high-spin refinement set");
          candidate = validateManifest({ ...baseline, tiles: [...baseline.tiles, ...extra.tiles] });
        }
      } catch (error) {
        candidate = baseline;
        highRefinementError = error.message;
      }
      if (disposed || token !== manifestGeneration) return;
      manifest = candidate;
      manifestStatus.textContent = highRefinementError ? "High-spin close-ups are unavailable." : "";
      retryRefinements.hidden = !highRefinementError;
    } catch (error) {
      if (disposed || token !== manifestGeneration) return;
      manifestStatus.textContent = `Refined views unavailable: ${error.message}. The overview still works.`;
      manifestStatus.dataset.error = "true";
      retryRefinements.hidden = false;
    } finally {
      if (token === manifestGeneration) { manifestLoading = undefined; updateControls(); }
    }
  })();
  manifestLoading = loading;
  return loading;
}

function tileFor(selection) {
  return manifest?.tiles.find((tile) => tile.metric === selection.metric && tile.side === selection.side && tile.level === selection.level);
}
function selectionKey(selection) {
  return selection.view === "overview" ? selection.metric : `tile:${tileFor(selection)?.id}`;
}
function screenSize(tile) {
  const spans = [tile.bounds_qx, tile.bounds_qy].map(([low, high]) =>
    Number(((high - low) * SCREEN_DISTANCE_M).toPrecision(2)));
  return `${spans.join(" × ")} M`;
}
function viewLabel(selection) {
  if (selection.view === "overview") return "Overview · 60° vertical field";
  const edge = selection.side === "left" ? "Left edge" : "Right edge";
  return `${edge} · ${selection.level === "deep" ? "Narrow patch" : "Wide patch"}`;
}

async function selectView(patch) {
  if (!initialized || disposed) return;
  const selection = { ...requestedSelection, ...patch };
  if (!METRICS[selection.metric] || !["overview", "refined"].includes(selection.view) || !["left", "right"].includes(selection.side) || !["modest", "deep"].includes(selection.level)) return;
  if (selection.metric === "kerr099" && selection.view === "refined" && !tileFor(selection)) selection.view = "overview";
  const tile = selection.view === "refined" ? tileFor(selection) : null;
  if (selection.view === "refined" && !tile) return;
  const token = ++mapGeneration;
  requestedSelection = selection;
  requestedMetric = selection.metric;
  cancelQueuedMapLoad(selectionKey(selection));
  const description = `${METRICS[selection.metric].label} · ${viewLabel(selection)}`;
  if (activeMap?.key === selectionKey(selection)) {
    mapLoading = false;
    // Keep remembered side/level even when returning to the current overview.
    activeMap.selection = { ...selection };
    metricStatus.textContent = "";
    metricStatus.dataset.error = "false";
    showViewContext(activeMap);
    updateControls();
    return;
  }
  mapLoading = true;
  metricStatus.textContent = `Loading and validating ${description}… Current view remains active.`;
  metricStatus.dataset.error = "false";
  updateControls();
  try {
    const bundle = await loadMapBundle(selection.metric, tile);
    if (token !== mapGeneration || disposed) return;
    commitMap({ ...bundle, selection });
    metricStatus.textContent = "";
  } catch (error) {
    if (token !== mapGeneration || disposed) return;
    requestedSelection = { ...activeMap.selection };
    requestedMetric = activeMap.id;
    metricStatus.textContent = `Could not load ${description}: ${error.message}. ${METRICS[activeMap.id].label} · ${viewLabel(activeMap.selection)} remains active. Select again to retry.`;
    metricStatus.dataset.error = "true";
  } finally {
    if (token === mapGeneration && !disposed) { mapLoading = false; updateControls(); }
  }
}

function selectMetric(id) { return selectView({ metric: id }); }

function showViewContext(bundle) {
  const { tile, selection } = bundle;
  document.querySelector("#active-view").textContent = viewLabel(selection);
  document.querySelector("#view-kind").textContent = tile ? `${tile.side === "left" ? "Left" : "Right"} critical edge` : "Full overview";
  document.querySelector("#refinement-value").textContent = tile ? `${tile.linear_zoom.toLocaleString("en-US")}×` : "1×";
  document.querySelector("#overview-span").textContent = tile ? tile.overview_pixels_per_tile.map((n) => Number(n.toPrecision(6))).join(" × ") : "640 × 480";
  const boundsX = tile?.bounds_qx || [-OVERVIEW.width * OVERVIEW.stepQ / 2, OVERVIEW.width * OVERVIEW.stepQ / 2];
  const boundsY = tile?.bounds_qy || [-OVERVIEW.height * OVERVIEW.stepQ / 2, OVERVIEW.height * OVERVIEW.stepQ / 2];
  const formatBounds = (pair) => pair.map((n) => n.toFixed(tile ? 9 : 6)).join(" … ");
  document.querySelector("#qx-bounds").textContent = formatBounds(boundsX);
  document.querySelector("#qy-bounds").textContent = formatBounds(boundsY);
  document.querySelector("#view-description").textContent = tile
    ? "Edge-aligned comparison: same sampling scale, each spacetime’s own critical point. These rays were recomputed inside the stated bounds."
    : "The same 640 × 480 observer camera across spins, with a 60° vertical field.";
  document.querySelector("#sampling-note").textContent = tile
    ? "Finite pixel and subray sampling. Finer winding bands remain unresolved; this is not a convergence claim."
    : "The dark region is the capture shadow, not the event horizon.";
  const reference = quadrantsButton
    ? (bundle.id === "kerr099" ? "data/kerr-a099/quadrants.png" : bundle.id === "kerr" ? "kerr-quadrants-toggle.png" : "schwarzschild-quadrants-toggle.png")
    : "data/schwarzschild-octants/overview-r20.png";
  document.querySelector("#locator-image").setAttribute("href", reference);
  const extent = document.querySelector("#locator-extent");
  // SVG has top-down y; ray-map rows and q_y are bottom-up. Use exact bounds,
  // never assume the critical point is at the patch center (it is not).
  const x = OVERVIEW.width / 2 + boundsX[0] / OVERVIEW.stepQ;
  const y = OVERVIEW.height / 2 - boundsY[1] / OVERVIEW.stepQ;
  extent.setAttribute("x", x);
  extent.setAttribute("y", y);
  extent.setAttribute("width", (boundsX[1] - boundsX[0]) / OVERVIEW.stepQ);
  extent.setAttribute("height", (boundsY[1] - boundsY[0]) / OVERVIEW.stepQ);
  const marker = document.querySelector("#locator-marker");
  const crosshair = document.querySelector("#locator-crosshair");
  marker.setAttribute("visibility", tile ? "visible" : "hidden");
  crosshair.setAttribute("visibility", tile ? "visible" : "hidden");
  if (tile) {
    const cx = OVERVIEW.width / 2 + tile.critical_point_q[0] / OVERVIEW.stepQ;
    const cy = OVERVIEW.height / 2 - tile.critical_point_q[1] / OVERVIEW.stepQ;
    marker.setAttribute("cx", cx); marker.setAttribute("cy", cy);
    crosshair.setAttribute("d", `M ${cx - 16} ${cy} h 10 M ${cx + 6} ${cy} h 10 M ${cx} ${cy - 16} v 10 M ${cx} ${cy + 6} v 10`);
  }
  document.querySelector("#locator-caption").textContent = tile ? "Crosshair: critical point · outline: actual tile bounds (may be subpixel)" : "Full overview · fixed sky reference";
  document.querySelector("#locator-desc").textContent = `${METRICS[bundle.id].name} overview. ${tile ? `Actual ${tile.side}-edge patch spans ${tile.overview_pixels_per_tile.join(" by ")} overview pixels.` : "The whole view is active."}`;
}

function makeShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${message}`);
  }
  return shader;
}

function makeProgram() {
  const result = gl.createProgram();
  const vertex = makeShader(gl.VERTEX_SHADER, vertexSource);
  const fragment = makeShader(gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(result, vertex);
  gl.attachShader(result, fragment);
  gl.linkProgram(result);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(`Shader link failed: ${gl.getProgramInfoLog(result)}`);
  return result;
}

function checkGl(label) {
  if (gl.isContextLost()) throw new Error("The WebGL context was lost; reload the page to recover");
  const error = gl.getError();
  if (error !== gl.NO_ERROR) throw new Error(`${label} (WebGL error 0x${error.toString(16)})`);
}

function createSourceTexture() {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function uploadDataTexture(unit, width, height, data, integer = false) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, integer ? gl.RG32I : gl.RG32F, width, height, 0, integer ? gl.RG_INTEGER : gl.RG, integer ? gl.INT : gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  try { checkGl("Could not upload ray-map texture"); }
  catch (error) { gl.deleteTexture(texture); throw error; }
  return texture;
}

function uploadCodeTexture(unit, width, height, data) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, width, height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  try { checkGl("Could not upload exact-quadrant texture"); }
  catch (error) { gl.deleteTexture(texture); throw error; }
  return texture;
}

function uploadScalarTexture(unit, width, height, data, rgba = false) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, rgba ? gl.RGBA32F : gl.R32F, width, height, 0, rgba ? gl.RGBA : gl.RED, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  try { checkGl("Could not upload pixel-area sampling texture"); }
  catch (error) { gl.deleteTexture(texture); throw error; }
  return texture;
}

function drawFrame() {
  checkGl("Could not prepare the image");
  const visible = blackHoleInput.checked;
  gl.uniform1i(gl.getUniformLocation(program, "uUnlensedReference"), Number(!visible));
  canvas.dataset.blackHoleVisible = String(visible);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  checkGl("Could not render the image");
}

function describeMainView() {
  const visible = blackHoleInput.checked;
  canvas.setAttribute("aria-label", visible
    ? `${METRICS[activeMap.id].label} lensed background with a black capture shadow`
    : "Unlensed background viewed along straight light paths");
  document.querySelector("#capture-legend").hidden = !visible;
}

function drawSource(source, photoPatch = false) {
  checkGl("Could not prepare the source");
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  if (!positiveInteger(width) || !positiveInteger(height)) throw new Error("The source has no decoded image data");
  if (width > maxTextureSize || height > maxTextureSize) throw new Error(`Source exceeds this GPU's ${maxTextureSize}-pixel texture limit`);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, photoPatch ? gl.CLAMP_TO_EDGE : gl.REPEAT);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  checkGl("Could not upload the source image");
  gl.uniform1i(gl.getUniformLocation(program, "uPhotoPatch"), Number(photoPatch));
  gl.uniform1f(gl.getUniformLocation(program, "uSourceAspect"), width / height);
  drawFrame();
}

function useProceduralSkyTexture() {
  // Octant colors come from the ray direction in the shader. Keep the sampler
  // complete with a single texel so switching back from a photo frees its pixels.
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.uniform1i(gl.getUniformLocation(program, "uPhotoPatch"), 0);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not decode image: ${url.startsWith("blob:") ? "selected file" : url}`));
    image.src = assetUrl(url);
  });
}

function updateSourceDescription() {
  const patch = sourceKind === "photo" || sourceKind === "video";
  document.querySelector("#source-description").textContent = patch
    ? "Photo patch at infinity · 90° vertical field. Slate is outside the photo."
    : sourceKind === "octants" && activeMap?.octants?.pixels
      ? "Eight octants at infinity. AA integrates actual Kerr source-boundary areas; capture remains black. Both source hemispheres contribute."
    : sourceKind === "octants"
      ? "Eight octants of the whole sky at infinity. Blue/red/yellow/green: behind the black hole (−x). Purple/orange/pink/cyan: observer side (+x)."
    : sourceKind === "quadrants" && activeMap?.quadrants?.pixels
      ? "Ideal sharp four-color sphere. With AA on, actual geodesic color-boundary areas are integrated over each pixel. Other backgrounds use finite weighted ray samples."
      : sourceKind === "quadrants" && activeMap?.quadrants
      ? "Ideal sharp four-color sphere. Refined tiles use exact quadrant labels before UV rounding; finite subray colors are averaged."
      : sourceKind === "quadrants"
      ? "Sharp four-color sphere. Each overview ray selects one quadrant directly; antialiasing averages ray colors within a screen pixel."
      : sourceKind === "sky"
      ? "ESO/S. Brunier’s Milky Way panorama—the same photograph used in the moving-black-hole video."
      : "Complete celestial sphere at infinity · equirectangular texture with continuous longitude. Built-in textures use bilinear filtering.";
  updateSamplingDescription();
}

function setSourceLabel(kind, label) {
  const changed = sourceKind !== kind;
  sourceKind = kind;
  gl.uniform1i(gl.getUniformLocation(program, "uUseQuadrants"), Number(kind === "quadrants" && Boolean(activeMap?.quadrants)));
  gl.uniform1i(gl.getUniformLocation(program, "uIdealFourColors"), Number(kind === "quadrants"));
  gl.uniform1i(gl.getUniformLocation(program, "uEightOctants"), Number(kind === "octants"));
  gl.uniform1i(gl.getUniformLocation(program, "uUseQuadrantPixels"), Number(kind === "quadrants" && Boolean(activeMap?.quadrants?.pixels)));
  gl.uniform1i(gl.getUniformLocation(program, "uUseOctantPixels"), Number(kind === "octants" && Boolean(activeMap?.octants?.pixels)));
  document.querySelector("#source-label").textContent = label;
  quadrantsButton?.setAttribute("aria-pressed", String(kind === "quadrants"));
  octantsButton.setAttribute("aria-pressed", String(kind === "octants"));
  skyButton.setAttribute("aria-pressed", String(kind === "sky"));
  gridButton?.setAttribute("aria-pressed", String(kind === "grid"));
  const patch = kind === "photo" || kind === "video";
  updateSourceDescription();
  const legend = document.querySelector("#field-legend");
  legend.hidden = !patch;
  legend.replaceChildren();
  const swatch = document.createElement("i");
  swatch.className = `swatch ${patch ? "slate" : "light"}`;
  swatch.setAttribute("aria-hidden", "true");
  legend.append(swatch, patch ? " Beyond photo field" : " Celestial sphere");
  // Built-ins and photos first upload their source, then select its kind. Draw
  // once more only when the source-specific quadrant branch changes.
  if (changed) drawFrame();
}

function useBuiltin(kind) {
  return runOperation("Background error", async (token) => {
    closeCamera();
    if (kind === "octants" && !quadrantsButton) {
      useProceduralSkyTexture();
      setSourceLabel("octants", initialColorLabel);
      setStatus("");
      return;
    }
    const sources = {
      quadrants: { file: "source-quadrants.png", name: "infinite four-color background", label: "Infinite four-color background", patch: false },
      octants: { file: "source-quadrants.png", name: "eight-octant sky", label: "Eight-color sky at infinity", patch: false },
      sky: { file: "source-milky-way.jpg", name: "Milky Way photograph", label: "Milky Way · ESO/S. Brunier", patch: false },
      grid: { file: "source-grid.png", name: "diagnostic grid", label: "Diagnostic celestial grid", patch: false },
    };
    const selected = sources[kind];
    if (!selected) throw new Error("Unknown built-in source");
    setStatus(`Loading ${selected.name}…`);
    const image = await loadImage(selected.file);
    if (!isCurrent(token)) return;
    drawSource(image, selected.patch);
    setSourceLabel(kind, selected.label);
    setStatus(usesKerrStills ? "" : kind === "quadrants" && activeMap?.quadrants?.pixels ? "Showing the ideal sharp four-color sphere. Antialiasing integrates actual color-boundary areas; turn it off to inspect center rays." : kind === "quadrants" ? "Showing the sharp four-color sphere. Rays select quadrant colors directly; antialiasing averages colors within each screen pixel." : `Showing the ${selected.name}. Every UV selects a direction on the celestial sphere.`);
  });
}

function stopTracks(stream) {
  if (stream) for (const track of stream.getTracks()) track.stop();
}

function closeCamera() {
  videoIsRunning = false;
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
  animationFrame = undefined;
  if (cancelCameraReady) cancelCameraReady();
  stopTracks(cameraStream);
  cameraStream = undefined;
  camera.srcObject = null;
  videoButton.textContent = "Start video";
}

function waitForCameraFrame() {
  if (camera.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      camera.removeEventListener("loadeddata", ready);
      camera.removeEventListener("error", failed);
      cancelCameraReady = undefined;
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("The camera did not produce a frame")); };
    cancelCameraReady = () => { cleanup(); reject(new Error("Camera operation was cancelled")); };
    camera.addEventListener("loadeddata", ready, { once: true });
    camera.addEventListener("error", failed, { once: true });
    timer = setTimeout(failed, 15000);
  });
}

async function openCamera(token) {
  if (cameraStream) return cameraStream;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires a supported browser on HTTPS or localhost");
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
  if (!isCurrent(token)) { stopTracks(stream); return null; }
  cameraStream = stream;
  camera.srcObject = stream;
  try {
    await camera.play();
    if (!isCurrent(token)) { stopTracks(stream); return null; }
    await waitForCameraFrame();
    if (!isCurrent(token)) { stopTracks(stream); return null; }
    return stream;
  } catch (error) {
    stopTracks(stream);
    if (cameraStream === stream) { cameraStream = undefined; camera.srcObject = null; }
    throw error;
  }
}

function drawVideoFrame() {
  if (!videoIsRunning || disposed) return;
  try {
    if (camera.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) drawSource(camera, true);
    animationFrame = requestAnimationFrame(drawVideoFrame);
  } catch (error) {
    closeCamera();
    setStatus(`Video error: ${error.message}`, true);
  }
}

function toggleVideo() {
  return runOperation("Camera error", async (token) => {
    if (videoIsRunning) {
      closeCamera();
      setStatus("Camera stopped. The last lensed frame remains available to save.");
      return;
    }
    setStatus("Requesting camera access…");
    if (!await openCamera(token) || !isCurrent(token)) return;
    videoIsRunning = true;
    videoButton.textContent = "Stop video";
    setSourceLabel("video", "Live camera · 90° sky patch");
    setStatus("Live camera. Slate is beyond the photo field; black marks captured rays.");
    drawVideoFrame();
  });
}

function takePicture() {
  return runOperation("Camera error", async (token) => {
    setStatus("Preparing a camera picture…");
    if (!await openCamera(token) || !isCurrent(token)) return;
    drawSource(camera, true);
    closeCamera();
    setSourceLabel("photo", "Camera picture · 90° sky patch");
    setStatus("Camera picture captured and camera released.");
  });
}

function useUploadedImage() {
  const [file] = uploadInput.files;
  if (!file) return Promise.resolve();
  return runOperation("Upload error", async (token) => {
    closeCamera();
    setStatus(`Decoding ${file.name}…`);
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await loadImage(objectUrl);
      if (!isCurrent(token)) return;
      drawSource(image, true);
      setSourceLabel("photo", `${file.name} · 90° sky patch`);
      setStatus(`Loaded ${file.name} at its original resolution. Slate is beyond the photo field.`);
    } finally {
      URL.revokeObjectURL(objectUrl);
      uploadInput.value = "";
    }
  });
}

function setAntialias() {
  if (!initialized || busy || disposed) return;
  try {
    const enabled = hasAntialias && antialiasInput.checked;
    gl.uniform1i(gl.getUniformLocation(program, "uUseAntialias"), Number(enabled));
    drawFrame();
    updateSamplingDescription();
    setStatus(enabled ? activeMap.quadrants?.pixels && sourceKind === "quadrants" ? "Antialiasing enabled: actual four-color boundary areas integrated over each pixel." : activeMap.weights ? "Antialiasing enabled: positive whole-pixel area weights on geodesic samples; capture area remains black." : "Adaptive supersampling enabled. Subray colors are averaged independently." : "Single-ray view. Antialiasing is off.");
  } catch (error) { setStatus(`Render error: ${error.message}`, true); }
}

function downloadImage() {
  return runOperation("Download error", async (token) => {
    const exportName = activeMap.tile ? `${activeMap.tile.id}-lensing.png` : METRICS[activeMap.id].download;
    const exportWidth = canvas.width;
    const exportHeight = canvas.height;
    // Redraw even for a still source: browsers can discard the drawing buffer.
    if (videoIsRunning && camera.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) drawSource(camera, true);
    else drawFrame();
    gl.finish();
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    checkGl("Could not read the rendered image");
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const context = exportCanvas.getContext("2d");
    if (!context) throw new Error("Could not create the PNG export canvas");
    const imageData = context.createImageData(canvas.width, canvas.height);
    const rowBytes = canvas.width * 4;
    for (let y = 0; y < canvas.height; y += 1) {
      imageData.data.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), (canvas.height - y - 1) * rowBytes);
    }
    context.putImageData(imageData, 0, 0);
    const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, "image/png"));
    if (!isCurrent(token)) return;
    if (!blob) throw new Error("Could not encode the PNG");
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = exportName;
    document.body.append(link);
    link.click();
    link.remove();
    // Give the browser time to consume the Blob after the synthetic click.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    setStatus(`PNG download requested · ${exportWidth} × ${exportHeight} pixels.`);
  });
}

function showGeometry(map, antialias) {
  const g = map.geometry || {};
  const display = (selector, value, suffix = "", decimals = 1) => {
    document.querySelector(selector).textContent = Number.isFinite(value) ? `${Number(value.toFixed(decimals))}${suffix}` : "—";
  };
  document.querySelector("#metric-name").textContent = g.metric || "Unspecified";
  display("#observer-radius", g.observer_radius_M, " M");
  display("#field-of-view", g.vertical_fov_deg, "°");
  display("#horizon-radius", g.horizon_radius_M, " M");
  const spinning = METRICS[activeMap.id].spin > 0;
  display("#spin-value", METRICS[activeMap.id].spin, "", 2);
  document.querySelector("#photon-label").textContent = spinning ? "Photon region" : "Photon sphere";
  document.querySelector("#shadow-label").textContent = spinning ? "Shadow shape" : "Shadow radius";
  document.querySelector("#observer-description").textContent = g.observer || "Static equatorial observer aimed toward the center.";
  if (spinning) {
    document.querySelector("#photon-radius").textContent = "Orbit-dependent";
    document.querySelector("#shadow-angle").textContent = "Asymmetric";
  } else {
    display("#photon-radius", g.photon_sphere_radius_M, " M");
    display("#shadow-angle", g.shadow_angular_radius_deg, "°", 2);
  }
  updateSamplingDescription();
}

function updateSamplingDescription() {
  if (!activeMap) return;
  const { map, antialias, weights, quadrants } = activeMap;
  if (!blackHoleInput.checked) {
    document.querySelector("#map-summary").textContent = `${map.width} × ${map.height} / straight rays`;
    document.querySelector("#aa-detail").textContent = "The background uses straight camera directions while the black hole is hidden.";
    return;
  }
  const integrated = (sourceKind === "quadrants" && Boolean(quadrants?.pixels)) || (sourceKind === "octants" && Boolean(activeMap.octants?.pixels));
  const enabled = hasAntialias && antialiasInput.checked;
  antialiasDetail = !hasAntialias ? "This map contains one center ray per pixel."
    : integrated ? "Actual color-boundary areas integrated for this fixed source. The small unresolved winding-tail error is bounded in the numerical record."
    : weights ? `Up to ${map.antialias.max_samples} positively weighted ray samples per pixel. Capture area is black; finer arbitrary-source structure remains sampling-limited.`
    : `Up to ${map.antialias.max_samples} rays at ${antialias.selectedPixels.toLocaleString()} selected pixels. Fine rings remain resolution-limited.`;
  const label = !enabled ? "single ray" : integrated ? "color-area AA" : weights ? "weighted AA" : "adaptive AA";
  document.querySelector("#map-summary").textContent = `${map.width} × ${map.height} / ${label}`;
  document.querySelector("#aa-detail").textContent = enabled ? antialiasDetail : "Single center ray per pixel. Thin features may alias.";
}

function showLiveOverview(visible) {
  if (!hasBakedOverview) return;
  document.querySelector("#overview-image").hidden = visible;
  canvas.hidden = !visible;
}

async function main() {
  gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
  if (!gl) throw new Error("This browser does not support WebGL 2");
  maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const choseSky = () => hasBakedOverview && skyButton.getAttribute("aria-pressed") === "true";
  const [bundle, initialSource] = await Promise.all([
    loadMapBundle("schwarzschild"),
    quadrantsButton ? loadImage("source-quadrants.png") : choseSky() ? loadImage("source-milky-way.jpg") : null,
  ]);
  const skyImage = choseSky() ? initialSource || await loadImage("source-milky-way.jpg") : null;
  const showSky = Boolean(skyImage) && choseSky();
  if (disposed) return;
  const { map, antialias } = bundle;
  canvas.width = map.width;
  canvas.height = map.height;
  canvas.style.aspectRatio = `${map.width} / ${map.height}`;
  gl.viewport(0, 0, map.width, map.height);
  program = makeProgram();
  gl.useProgram(program);
  const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  const positionLocation = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  sourceTexture = createSourceTexture();
  for (const [name, unit] of [["uSource", 0], ["uWarp", 1], ["uSampleAtlas", 2], ["uSampleRanges", 3], ["uQuadrantCenter", 4], ["uQuadrantAtlas", 5], ["uSampleWeights", 6], ["uQuadrantPixels", 7], ["uOctantPixels", 8]]) gl.uniform1i(gl.getUniformLocation(program, name), unit);
  antialiasInput.checked = Boolean(antialias);
  commitMap(bundle, false);
  if (showSky || quadrantsButton) drawSource(showSky ? skyImage : initialSource, false);
  else {
    useProceduralSkyTexture();
    drawFrame();
  }
  setSourceLabel(showSky ? "sky" : initialColorSource, showSky ? "Milky Way · ESO/S. Brunier" : initialColorLabel);
  showGeometry(map, antialias);
  initialized = true;
  showLiveOverview(true);
  if (!usesSavedCloseups) loadRefinements();
  metricStatus.textContent = "";
  updateControls();
  setStatus(usesKerrStills ? "" : `Loaded ${map.width} × ${map.height} null-geodesic map${hasAntialias ? " with adaptive supersampling" : ""}. ${initialColorLabel} ready.`);
}

if (!usesSavedCloseups) {
  overviewButton.addEventListener("click", () => selectView({ view: "overview" }));
  refinedButton.addEventListener("click", () => selectView({ view: "refined" }));
  leftButton.addEventListener("click", () => selectView({ view: "refined", side: "left" }));
  rightButton.addEventListener("click", () => selectView({ view: "refined", side: "right" }));
  refinementSelect.addEventListener("change", () => selectView({ view: "refined", level: refinementSelect.value }));
  retryRefinements.addEventListener("click", loadRefinements);
}
if (usesKerrStills) {
  window.addEventListener("saved-view-opened", () => {
    const wasLive = videoIsRunning;
    generation += 1;
    closeCamera();
    busy = false;
    if (wasLive) setStatus("Camera stopped. The last lensed frame is still available.");
    updateControls();
  });
} else {
  schwarzschildButton.addEventListener("click", () => selectMetric("schwarzschild"));
  kerrButton.addEventListener("click", () => selectMetric("kerr"));
  highSpinButton.addEventListener("click", () => selectMetric("kerr099"));
}
blackHoleInput.addEventListener("change", () => {
  if (!initialized || disposed) return;
  drawFrame();
  describeMainView();
  updateSamplingDescription();
  updateControls();
});
quadrantsButton?.addEventListener("click", () => useBuiltin("quadrants"));
octantsButton.addEventListener("click", () => useBuiltin("octants"));
skyButton.addEventListener("click", () => useBuiltin("sky"));
gridButton?.addEventListener("click", () => useBuiltin("grid"));
videoButton.addEventListener("click", toggleVideo);
pictureButton.addEventListener("click", takePicture);
uploadButton.addEventListener("click", () => { if (initialized && !busy && !disposed) uploadInput.click(); });
uploadInput.addEventListener("change", useUploadedImage);
downloadButton.addEventListener("click", downloadImage);
antialiasInput.addEventListener("change", setAntialias);
window.addEventListener("pagehide", () => {
  disposed = true;
  generation += 1;
  mapGeneration += 1;
  cancelQueuedMapLoad();
  manifestGeneration += 1;
  manifestLoading = undefined;
  requestedSelection = activeMap ? { ...activeMap.selection } : { ...INITIAL_SELECTION };
  requestedMetric = requestedSelection.metric;
  mapLoading = false;
  busy = false;
  closeCamera();
  updateControls();
});
window.addEventListener("pageshow", () => {
  disposed = false;
  if (activeMap) { metricStatus.textContent = ""; metricStatus.dataset.error = "false"; }
  if (!usesSavedCloseups && initialized && !manifest) loadRefinements();
  if (!hasBakedOverview && !initialized && !rendererLost) startRenderer();
  updateControls();
});
canvas.addEventListener("webglcontextlost", () => {
  rendererLost = true;
  initialized = false;
  showLiveOverview(false);
  generation += 1;
  mapGeneration += 1;
  cancelQueuedMapLoad();
  manifestGeneration += 1;
  manifestLoading = undefined;
  requestedSelection = activeMap ? { ...activeMap.selection } : { ...INITIAL_SELECTION };
  requestedMetric = requestedSelection.metric;
  mapLoading = false;
  busy = false;
  closeCamera();
  updateControls();
  setStatus("The WebGL context was lost. Reload this page to restore the renderer.", true);
});
function startRenderer() {
  if (disposed || initialized || rendererLost) return;
  if (startupPending) { restartStartup = true; return startupPending; }
  restartStartup = false;
  const pending = main().catch((error) => {
    if (disposed) return;
    console.error(error);
    initialized = false;
    updateControls();
    setStatus(`Error: ${error.message}`, true);
  }).finally(() => {
    if (startupPending === pending) startupPending = undefined;
    if (restartStartup && !disposed && !initialized && !rendererLost) startRenderer();
  });
  startupPending = pending;
  return pending;
}
if (hasBakedOverview) {
  window.addEventListener("start-live-overview", () => {
    Promise.resolve(startRenderer()).finally(() => window.dispatchEvent(new Event("live-overview-started")));
  });
} else {
  startRenderer();
}
