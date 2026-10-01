// AI upscaling worker for the 高画質化 tool: loads onnxruntime-web + Real-ESRGAN and runs tiled inference.
// The page decodes the image (HEIC etc. need the DOM) and sends raw RGBA; tiles come back as RGBA.

const MODEL_URL = new URL('../libs/models/realesr-general-x4v3-dn-medium.onnx', self.location).href;
const MODEL_BYTES = 4866396;
// CPU runtime is self-hosted. The WebGPU build's WASM (26.8MB) exceeds Cloudflare Pages' 25MiB file limit → CDN.
// `bytes` are exact file sizes, used as progress totals (Content-Length may be the compressed size).
const RUNTIMES = {
  cpu: {
    base: new URL('../libs/ort/', self.location).href,
    script: 'ort.wasm.min.js',
    wasm: 'ort-wasm-simd-threaded.wasm',
    bytes: 14239897,
  },
  gpu: {
    base: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/',
    script: 'ort.webgpu.min.js',
    wasm: 'ort-wasm-simd-threaded.asyncify.wasm',
    bytes: 26781914,
  },
};

const MODEL_SCALE = 4;
const TILE = 256;
const PAD = 16;

let session = null;
let backend = null;
let cancelledJob = null;

self.onmessage = e => {
  const msg = e.data;
  if (msg.type === 'init') {
    init(msg.runtime).catch(err => {
      console.error(err);
      self.postMessage({ type: 'init-error', message: String(err && err.message || err) });
    });
  } else if (msg.type === 'run') {
    run(msg).catch(err => {
      console.error(err);
      self.postMessage({ type: 'error', jobId: msg.jobId, message: String(err && err.message || err) });
    });
  } else if (msg.type === 'cancel') {
    cancelledJob = msg.jobId;
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

async function init(runtimeName) {
  if (session) {
    self.postMessage({ type: 'ready', backend });
    return;
  }
  const rt = RUNTIMES[runtimeName] || RUNTIMES.cpu;
  if (typeof ort === 'undefined') importScripts(rt.base + rt.script);

  const total = rt.bytes + MODEL_BYTES;
  let loaded = 0;
  const onChunk = n => {
    loaded += n;
    self.postMessage({ type: 'download', loaded: Math.min(loaded, total), total });
  };
  const [wasm, model] = await Promise.all([
    fetchBytes(rt.base + rt.wasm, onChunk),
    fetchBytes(MODEL_URL, onChunk),
  ]);

  // No COOP/COEP on this site → SharedArrayBuffer is unavailable, so stay single-threaded.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = rt.base;
  ort.env.wasm.wasmBinary = wasm.buffer;
  if (rt === RUNTIMES.gpu) {
    try {
      session = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'] });
      backend = 'webgpu';
    } catch (err) {
      // Adapter present but unusable (driver/blocklist): the WebGPU build also runs on CPU.
      console.warn('WebGPU が使えないため CPU 処理に切り替えます', err);
    }
  }
  if (!session) {
    session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
    backend = 'wasm';
  }
  self.postMessage({ type: 'ready', backend });
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
// Alpha isn't modelled: it is upscaled bilinearly from the source when the image has transparency.
function composeTile(out, t, scale, src, width, height, hasAlpha) {
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
      rgba[d + 3] = hasAlpha ? sampleAlpha(src, width, height, (t.x * scale + i + 0.5) / scale - 0.5, (t.y * scale + j + 0.5) / scale - 0.5) : 255;
    }
  }
  return rgba;
}

function sampleAlpha(src, width, height, sx, sy) {
  sx = Math.min(Math.max(sx, 0), width - 1);
  sy = Math.min(Math.max(sy, 0), height - 1);
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
  const fx = sx - x0, fy = sy - y0;
  const a = (x, y) => src[(y * width + x) * 4 + 3];
  const top = a(x0, y0) + (a(x1, y0) - a(x0, y0)) * fx;
  const bottom = a(x0, y1) + (a(x1, y1) - a(x0, y1)) * fx;
  return top + (bottom - top) * fy;
}

// Let queued messages (e.g. 'cancel') run: session.run's continuation is only a microtask.
const yieldToEventLoop = () => new Promise(r => setTimeout(r, 0));

async function run({ jobId, width, height, rgba, scale, hasAlpha }) {
  if (!session) throw new Error('モデルが読み込まれていません');
  const src = new Uint8ClampedArray(rgba);
  const tiles = planTiles(width, height, TILE, PAD);
  for (let n = 0; n < tiles.length; n++) {
    await yieldToEventLoop();
    if (cancelledJob === jobId) {
      self.postMessage({ type: 'cancelled', jobId });
      return;
    }
    const t = tiles[n];
    const input = new ort.Tensor('float32', tileToTensorData(src, width, t), [1, 3, t.ph, t.pw]);
    const { output } = await session.run({ input });
    const tile = composeTile(await output.getData(), t, scale, src, width, height, hasAlpha);
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
