// Depth map generator for Cat Depth Lock.
// Deps:  npm i @huggingface/transformers@3 sharp
// Usage: node scripts/depth.mjs <inputImage> <outputDepthPng> [maxSide]
//   Optional env: LOCAL_MODEL_DIR=<parent of depth-anything-v2-small>, DTYPE=q8
// Downloads onnx-community/depth-anything-v2-small from the HF hub on first run.
// Env: LOCAL_MODEL_DIR (parent dir holding depth-anything-v2-small), DTYPE
import { pipeline, env } from "@huggingface/transformers";
import sharp from "sharp";

const [inPath, outPath, maxSideArg] = process.argv.slice(2);
const MAX_SIDE = Number(maxSideArg || 1024);
const DTYPE = process.env.DTYPE || "q8";
const LOCAL = process.env.LOCAL_MODEL_DIR;

if (!inPath || !outPath) {
  console.error("usage: node depth.mjs <in> <out> [maxSide]");
  process.exit(1);
}

let modelId = "onnx-community/depth-anything-v2-small";
if (LOCAL) {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = LOCAL;
  modelId = "depth-anything-v2-small";
  console.log("using LOCAL model dir:", LOCAL, "dtype", DTYPE);
} else {
  env.allowLocalModels = false;
  console.log("using REMOTE model, dtype", DTYPE);
}

console.log("loading depth model ...");
const depth = await pipeline("depth-estimation", modelId, { dtype: DTYPE });

console.log("reading", inPath);
const meta = await sharp(inPath).rotate().metadata();
const W = meta.width, H = meta.height;
console.log("source", W, "x", H);

const out = await depth(inPath);
const pd = out.predicted_depth; // Tensor [.., H', W'] float, larger = closer
const dims = pd.dims;
const dh = dims[dims.length - 2], dw = dims[dims.length - 1];
const data = pd.data;

let min = Infinity, max = -Infinity;
for (let i = 0; i < data.length; i++) { const v = data[i]; if (v < min) min = v; if (v > max) max = v; }
const range = (max - min) || 1;
const gray = Buffer.alloc(dh * dw);
for (let i = 0; i < data.length; i++) {
  gray[i] = Math.max(0, Math.min(255, Math.round(((data[i] - min) / range) * 255)));
}
console.log("depth tensor", dw, "x", dh, "min", min.toFixed(3), "max", max.toFixed(3));

await sharp(gray, { raw: { width: dw, height: dh, channels: 1 } })
  .resize(W, H, { fit: "fill", kernel: "cubic" })
  .blur(1.1)
  .png()
  .toFile(outPath);

console.log("wrote", outPath);
