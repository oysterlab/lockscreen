const exp = window.EXPERIMENT;
const roundStatus = {complete:"완료", running:"실행 중", scheduled:"예약"};

document.getElementById("runStatus").innerHTML = exp.rounds.map(r => `
  <span class="status-pill ${r.status}"><b>R${r.id}</b> ${roundStatus[r.status]} · ${r.started}</span>
`).join("");

document.getElementById("metricsGrid").innerHTML = exp.rounds.map(r => `
  <article class="metric-card ${r.status}">
    <div class="metric-top"><span>ROUND ${String(r.id).padStart(2,"0")}</span><span>${roundStatus[r.status]}</span></div>
    <div class="score">${r.score ?? "—"}<small>/100</small></div>
    <h3>${r.label}</h3>
    <dl>
      <div><dt>Identity</dt><dd>${r.identity ?? "—"}<small>/35</small></dd></div>
      <div><dt>Hard pass</dt><dd>${r.passRate == null ? "—" : r.passRate + "%"}</dd></div>
      <div><dt>BG SSIM</dt><dd>${r.ssim ?? "—"}</dd></div>
    </dl>
  </article>
`).join("");

document.getElementById("timeline").innerHTML = exp.rounds.map(r => `
  <article class="timeline-item ${r.status}">
    <div class="round-marker">R${r.id}</div>
    <div class="timeline-body">
      <div class="timeline-meta"><span>${r.started} KST</span><code>${r.diff}</code></div>
      <h3>${r.change}</h3>
      <p>${r.finding}</p>
    </div>
  </article>
`).join("");

const imgCell = (sample, round) => {
  const result = sample[`r${round}`];
  if (!result) return `<div class="image-cell pending"><span>R${round}</span><p>${exp.rounds[round-1].started} KST</p></div>`;
  const src = `assets/round-0${round}/${sample.id}.jpg`;
  return `<figure class="image-cell result ${result.fail ? "hard-fail" : "pass-result"}" data-image="${src}" data-caption="${sample.id} · Round ${round}">
    <img src="${src}" alt="${sample.id} Round ${round} result" loading="lazy">
    <figcaption><span>R${round} · ${result.total}</span><span>ID ${result.identity}/35</span></figcaption>
  </figure>`;
};

document.getElementById("sampleList").innerHTML = exp.samples.map((s, i) => `
  <article class="sample-row">
    <div class="sample-info">
      <span class="sample-index">${String(i+1).padStart(2,"0")}</span>
      <h3>${s.name}</h3>
      <p class="mono">${s.id}</p>
      <div class="tag-list">${s.tags.map(t => `<span>${t}</span>`).join("")}</div>
      <p class="review-note">${s.r3?.note || s.r2?.note || s.r1.note}</p>
    </div>
    <div class="compare-grid">
      <figure class="image-cell source" data-image="assets/source/${s.id}.jpg" data-caption="${s.id} · User source">
        <img src="assets/source/${s.id}.jpg" alt="${s.id} user source" loading="lazy">
        <figcaption><span>USER</span><span>Identity source</span></figcaption>
      </figure>
      ${imgCell(s, 1)}${imgCell(s, 2)}${imgCell(s, 3)}
    </div>
  </article>
`).join("");

const dialog = document.getElementById("lightbox");
document.addEventListener("click", e => {
  const cell = e.target.closest("[data-image]");
  if (!cell) return;
  dialog.querySelector("img").src = cell.dataset.image;
  dialog.querySelector("p").textContent = cell.dataset.caption;
  dialog.showModal();
});
dialog.querySelector("button").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); });

