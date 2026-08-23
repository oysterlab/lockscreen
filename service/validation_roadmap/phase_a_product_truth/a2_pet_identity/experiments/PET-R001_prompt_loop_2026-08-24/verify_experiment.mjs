#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const experimentDir = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(experimentDir, "../../../../../..");
const manifest = JSON.parse(readFileSync(join(experimentDir, "run-manifest.json"), "utf8"));
const sampleLines = readFileSync(join(experimentDir, "samples.csv"), "utf8").trim().split("\n").slice(1);
const sampleFiles = new Map(sampleLines.map(line => {
  const [, testId, , sourceFile] = line.split(",");
  return [testId, sourceFile];
}));

const sha256 = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

for (const ref of manifest.fixed_references) {
  const path = join(workspace, ref.path);
  check(`reference:${ref.role}`, existsSync(path) && sha256(path) === ref.sha256, path);
}

for (const sample of manifest.samples) {
  const sourceFile = sampleFiles.get(sample.test_id);
  const path = join(workspace, "service/resources/a2_pet_identity/influencer_daily_pool/good_inputs/images/cat", sourceFile || "");
  check(`source:${sample.test_id}`, Boolean(sourceFile) && existsSync(path) && sha256(path) === sample.sha256, path);
  check(`public-source:${sample.test_id}`, existsSync(join(workspace, `a2-prompt-loop-2026-08-24/assets/source/${sample.test_id}.jpg`)), "optimized public copy");
}

for (const round of manifest.rounds) {
  if (round.status !== "complete") continue;
  const dir = join(experimentDir, `outputs/round-${String(round.round).padStart(2, "0")}`);
  const outputIds = existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith(".png")).map(name => name.replace(/\.png$/, "")) : [];
  const missing = manifest.samples.map(sample => sample.test_id).filter(id => !outputIds.includes(id));
  check(`round-${round.round}:15-originals`, outputIds.length === 15 && missing.length === 0, `count=${outputIds.length}; missing=${missing.join("|") || "none"}`);
  const publicDir = join(workspace, `a2-prompt-loop-2026-08-24/assets/round-${String(round.round).padStart(2, "0")}`);
  const publicCount = existsSync(publicDir) ? readdirSync(publicDir).filter(name => name.endsWith(".jpg")).length : 0;
  check(`round-${round.round}:15-public`, publicCount === 15, `count=${publicCount}`);
  check(`round-${round.round}:scores`, existsSync(join(experimentDir, `round-${String(round.round).padStart(2, "0")}-scores.csv`)), "score archive");
}

const scheduled = manifest.rounds.map(round => new Date(round.scheduled_start_kst.replace(" ", "T") + "+09:00").getTime());
const gaps = scheduled.slice(1).map((time, index) => (time - scheduled[index]) / 3_600_000);
check("scheduled-intervals", gaps.every(hours => hours === 2), `hours=${gaps.join(",")}`);

const failed = checks.filter(item => !item.pass);
console.log(JSON.stringify({
  experiment: manifest.experiment_id,
  passed: checks.length - failed.length,
  total: checks.length,
  ok: failed.length === 0,
  failed
}, null, 2));

process.exitCode = failed.length ? 1 : 0;

