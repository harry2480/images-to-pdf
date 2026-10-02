// AI upscaling worker for the 高画質化 tool: loads onnxruntime-web + Real-ESRGAN and runs tiled inference.
// The page decodes the image (HEIC etc. need the DOM) and sends raw RGBA; tiles come back as RGBA.

const ORT_BASE = new URL('../libs/ort/', self.location).href;
const MODEL_URL = new URL('../libs/models/realesr-general-x4v3-dn-medium.onnx', self.location).href;
// Fallback totals for the progress bar when Content-Length is missing or reflects compressed size.
const WASM_BYTES = 14239897;
const MODEL_BYTES = 4866396;

const MODEL_SCALE = 4;
const TILE = 256;
const PAD = 16;

let session = null;

self.onmessage = e => {
  const msg = e.data;
  if (msg.type === 'init') {
    init().catch(err => {
      console.error(err);
      self.postMessage({ type: 'init-error', message: String(err && err.message || err) });
    });
  } else if (msg.type === 'run') {
    run(msg).catch(err => {
      console.error(err);
      self.postMessage({ type: 'error', jobId: msg.jobId, message: String(err && err.message || err) });
    });
  }
};

async function fetchBytes(url, onChunk) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    onChunk(value.length);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

async function init() {
  if (session) {
    self.postMessage({ type: 'ready', backend: 'wasm' });
    return;
  }
  importScripts(ORT_BASE + 'ort.wasm.min.js');

  const total = WASM_BYTES + MODEL_BYTES;
  let loaded = 0;
  const onChunk = n => {
    loaded += n;
    self.postMessage({ type: 'download', loaded: Math.min(loaded, total), total });
  };
  const [wasm, model] = await Promise.all([
    fetchBytes(ORT_BASE + 'ort-wasm-simd-threaded.wasm', onChunk),
    fetchBytes(MODEL_URL, onChunk),
  ]);

  // No COOP/COEP on this site → SharedArrayBuffer is unavailable, so stay single-threaded.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = ORT_BASE;
  ort.env.wasm.wasmBinary = wasm.buffer;
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
  self.postMessage({ type: 'ready', backend: 'wasm' });
}

// Split the image into TILE-sized cores, each with up to PAD px of context on every side.
function planTiles(width, height, tile, pad) {
  const tiles = [];
  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      const w = Math.min(tile, width - x);
      const h = Math.min(tile, height - y);
      const px = Math.max(0, x - pad);
      const py = Math.max(0, y - pad);
      tiles.push({
        x, y, w, h, px, py,
        pw: Math.min(width, x + w + pad) - px,
        ph: Math.min(height, y + h + pad) - py,
      });
    }
  }
  return tiles;
}

// RGBA (whole image) → planar RGB float32 in [0, 1] for the padded tile region.
function tileToTensorData(src, width, t) {
  const plane = t.pw * t.ph;
  const data = new Float32Array(plane * 3);
  for (let j = 0; j < t.ph; j++) {
    let s = ((t.py + j) * width + t.px) * 4;
    let d = j * t.pw;
    for (let i = 0; i < t.pw; i++, s += 4, d++) {
      data[d] = src[s] / 255;
      data[d + plane] = src[s + 1] / 255;
      data[d + plane * 2] = src[s + 2] / 255;
    }
  }
  return data;
}

// Model output (x4, padded) → RGBA for the tile core at `scale`.
// For x2 each output pixel averages a 2×2 block, so no full x4 image is ever materialised.
function composeTile(out, t, scale) {
  const f = MODEL_SCALE / scale;
  const outW = t.pw * MODEL_SCALE;
  const plane = outW * t.ph * MODEL_SCALE;
  const offX = (t.x - t.px) * MODEL_SCALE;
  const offY = (t.y - t.py) * MODEL_SCALE;
  const w = t.w * scale;
  const h = t.h * scale;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const norm = 255 / (f * f);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < f; dy++) {
        let k = (offY + j * f + dy) * outW + offX + i * f;
        for (let dx = 0; dx < f; dx++, k++) {
          r += out[k];
          g += out[k + plane];
          b += out[k + plane * 2];
        }
      }
      const d = (j * w + i) * 4;
      rgba[d] = r * norm; // Uint8ClampedArray rounds and clamps
      rgba[d + 1] = g * norm;
      rgba[d + 2] = b * norm;
      rgba[d + 3] = 255;
    }
  }
  return rgba;
}

async function run({ jobId, width, height, rgba, scale }) {
  if (!session) throw new Error('モデルが読み込まれていません');
  const src = new Uint8ClampedArray(rgba);
  const tiles = planTiles(width, height, TILE, PAD);
  for (let n = 0; n < tiles.length; n++) {
    const t = tiles[n];
    const input = new ort.Tensor('float32', tileToTensorData(src, width, t), [1, 3, t.ph, t.pw]);
    const { output } = await session.run({ input });
    const tile = composeTile(output.data, t, scale);
    input.dispose();
    output.dispose();
    self.postMessage({
      type: 'tile', jobId,
      x: t.x * scale, y: t.y * scale, w: t.w * scale, h: t.h * scale,
      rgba: tile.buffer, done: n + 1, total: tiles.length,
    }, [tile.buffer]);
  }
  self.postMessage({ type: 'done', jobId });
}
