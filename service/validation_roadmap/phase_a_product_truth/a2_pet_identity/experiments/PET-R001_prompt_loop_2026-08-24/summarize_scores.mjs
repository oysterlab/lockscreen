#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const experimentDir = dirname(fileURLToPath(import.meta.url));
const round = Number(process.argv[2]);

if (![1, 2, 3].includes(round)) {
  console.error("Usage: node summarize_scores.mjs <1|2|3>");
  process.exit(2);
}

const path = join(experimentDir, `round-${String(round).padStart(2, "0")}-scores.csv`);
const lines = readFileSync(path, "utf8").trim().split("\n");
const headers = lines.shift().split(",");
const rows = lines.map(line => {
  const values = line.split(",");
  return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
});

const mean = key => rows.reduce((sum, row) => sum + Number(row[key]), 0) / rows.length;
const hardFails = rows.filter(row => row.hard_fail === "yes").length;
const tags = new Map();
for (const row of rows) {
  for (const tag of (row.failure_tags || "").split(";").filter(Boolean)) {
    tags.set(tag, (tags.get(tag) || 0) + 1);
  }
}

console.log(JSON.stringify({
  round,
  samples: rows.length,
  mean_total: Number(mean("total_100").toFixed(1)),
  mean_identity: Number(mean("identity_35").toFixed(1)),
  hard_fails: hardFails,
  hard_pass_rate: Number((((rows.length - hardFails) / rows.length) * 100).toFixed(1)),
  mean_background_top_ssim: Number(mean("background_top_ssim").toFixed(3)),
  failure_tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }))
}, null, 2));

