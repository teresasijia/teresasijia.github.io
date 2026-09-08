/* demo.js -- the elicitation game.
 *
 * No model arithmetic here. The tree fixes the questions and never sees the draws, so one tree
 * serves every sample; estimation was enumerated offline for all six draw patterns. The page
 * samples a box, walks a heap, builds an answer index, and reads two tables.
 *
 *   node <- 2 * node + 1 + answer            walk the tree to the next question
 *   path <- sum(answer_k << (depth-1-k))     first answer is the most significant bit
 *
 * The box follows Study 2: the composition multiset {10,20,30,40} is permuted across colors, and
 * the draw history is SAMPLED from it. So the permutation belongs to the composition, not to the
 * draws. Because every model here is color-exchangeable, the sampled counts are looked up as
 * (sorted pattern, color permutation) -- an indexing device, not a claim about the design.
 */

const S = {
  man: null, tree: null, preds: null, curve: null,
  node: 0, answers: [], asked: [], stage: "intro", selected: null, pending: null,
  counts: null, pattern: 0, perm: null, draws: [],
};

/* A refresh should not cost someone their answers, so the urn, the draws and the answers live in
   sessionStorage until the tab closes. Nothing leaves the browser. */
const KEY = "dose-demo-v1";

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({
      draws: S.draws, counts: S.counts, perm: S.perm, pattern: S.pattern,
      node: S.node, answers: S.answers, asked: S.asked, stage: S.stage,
    }));
  } catch (e) { /* private mode, or storage disabled: play on without resume */ }
}

function clearSaved() {
  try { sessionStorage.removeItem(KEY); } catch (e) {}
}

function restore() {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (!v || !Array.isArray(v.draws) || v.draws.length !== S.man.n_draws) return false;
    if (!Array.isArray(v.answers) || v.answers.length > S.man.depth) return false;
    Object.assign(S, v);
    renderUrn();
    return true;
  } catch (e) { return false; }
}

const $ = (id) => document.getElementById(id);

const CURVE_COLORS = ["#7a2d2d", "#2f6f8f", "#57813f", "#946a1f", "#6a4a86", "#8f5a2f"];

async function boot() {
  const [man, tree, preds] = await Promise.all([
    fetch("assets/demo_manifest.json").then((r) => r.json()),
    fetch("assets/tree.bin").then((r) => r.arrayBuffer()),
    fetch("assets/predictions.bin").then((r) => r.arrayBuffer()),
  ]);
  S.man = man;
  S.tree = new Int16Array(tree);
  S.preds = new Uint16Array(preds);

  // curve.bin is 2.9 MB, three quarters of this page's payload, and nothing reads it until the
  // results screen -- ten questions away. Blocking the Start button on it makes every visitor wait
  // for data most of them reach a minute later, if at all. Start the fetch now, do not await it,
  // and let showResults draw once it lands. A failure leaves the plot empty and the rest intact.
  S.curveReady = fetch("assets/curve.bin")
    .then((r) => r.arrayBuffer())
    .then((b) => { S.curve = new Uint16Array(b); })
    .catch((e) => console.error("curve.bin did not load; the fitted-curve plot stays empty", e));
  $("start").disabled = false;
  $("start").textContent = "Start";

  if (!restore()) { sampleBox(); return; }
  if (S.stage === "results") showResults();
  else if (S.stage === "play") askNext();
  else if (S.stage === "draw") { show("draw"); playDraw(false); }
}

/* ---------- the box: permute the composition, then sample the draws ---------- */
function shuffled(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

function sampleBox() {
  const m = S.man;
  const weights = shuffled(m.composition_multiset); // composition, permuted across colors
  const total = weights.reduce((a, b) => a + b, 0);

  const counts = [0, 0, 0, 0];
  S.draws = [];
  for (let d = 0; d < m.n_draws; d++) {
    let r = Math.random() * total;
    let k = 0;
    while (r >= weights[k] && k < weights.length - 1) r -= weights[k++];
    counts[k]++;
    S.draws.push(k);
  }

  // Index the precomputed tables: sort colors by descending count to get the pattern, and keep
  // the ordering as the permutation from canonical slot to displayed color.
  const order = [0, 1, 2, 3].sort((a, b) => counts[b] - counts[a] || a - b);
  const sorted = order.map((i) => counts[i]);
  S.counts = counts;
  S.perm = order;
  S.pattern = m.draw_patterns.findIndex((p) => p.every((v, i) => v === sorted[i]));
  renderUrn();
}

/* Canonical color k is displayed as color perm[k], so a canonical event code maps letter by
   letter. Every model is color-exchangeable, so this is a pure relabelling. */
function displayEvent(code) {
  const m = S.man;
  return code
    .split("")
    .map((ch) => m.colors[S.perm[m.colors.indexOf(ch)]])
    .sort((a, b) => m.colors.indexOf(a) - m.colors.indexOf(b))
    .join("");
}

function displayName(code) {
  return S.man.event_names[displayEvent(code)];
}

function renderUrn() {
  const cols = S.man.colors;
  $("drawBalls").innerHTML = S.draws.map((k) => `<div class="draw-ball ${cols[k]}"></div>`).join("");
  $("drawSummaryRow").innerHTML = cols
    .map(
      (c, k) =>
        `<div class="summary-item"><div class="summary-ball ${c}"></div>
         <span>${cap(S.man.event_names[c])} &times; ${S.counts[k]}</span></div>`
    )
    .join("");
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

/* Study 2 reveals the draws one at a time, then shows the summary and only then the button. */
function playDraw(animate) {
  const balls = [...document.querySelectorAll("#drawBalls .draw-ball")];
  const status = $("drawStatus");
  const summary = $("drawSummary");
  const nextRow = $("drawNextRow");

  if (!animate) {
    balls.forEach((b) => b.classList.add("visible"));
    status.textContent = `All ${balls.length} balls have been drawn and recorded.`;
    summary.style.display = "block";
    nextRow.classList.add("visible");
    return;
  }

  balls.forEach((b) => b.classList.remove("visible"));
  summary.style.display = "none";
  nextRow.classList.remove("visible");

  let i = 0;
  (function step() {
    if (i < balls.length) {
      status.textContent = `Drawing ball ${i + 1} of ${balls.length}...`;
      balls[i].classList.add("visible");
      i++;
      setTimeout(step, 260);
    } else {
      setTimeout(() => {
        status.textContent = `All ${balls.length} balls have been drawn and recorded.`;
        summary.style.display = "block";
        nextRow.classList.add("visible");
      }, 400);
    }
  })();
}

/* ---------- questions ---------- */
function question(node) {
  const j = S.tree[node];
  const nP = S.man.n_probes;
  // n_probes is 101, so the offer is already a whole number of balls out of 100.
  return { event: S.man.events[Math.floor(j / nP)], p100: j % nP };
}

function askNext() {
  const k = S.answers.length;
  if (k === S.man.depth) return showResults();

  const { event, p100 } = question(S.node);
  S.asked = S.asked.slice(0, k);   // idempotent: a resume re-asks the same question
  S.asked.push(event);
  S.stage = "play";
  save();

  const m = S.man;
  const d = displayEvent(event);          // the code in the colors this visitor is seeing
  const name = m.event_names[d];
  S.pending = { d, name, p100 };

  $("secHeader").innerHTML =
    `Question <strong>${k + 1} of ${m.depth}</strong> &mdash; Which option do you prefer?`;

  $("drawsText").innerHTML =
    `You saw ${m.n_draws} <span class="has-tip">example draws<span class="tip">After each draw,
     the ball was returned to the box before the next was drawn.</span></span> from the ambiguous
     box. The <span class="has-tip">winning color<span class="tip">You win $5 if the ball drawn
     from the box you choose is a winning color; otherwise $0.</span></span> for this question is
     ${name}.`;

  $("sumRow").innerHTML = m.colors
    .map(
      (c, i) =>
        `<div class="summary-item ${d.includes(c) ? "win" : "dim"}">
           <div class="summary-ball ${c}"></div>
           <span>${cap(m.event_names[c])} &times; ${S.counts[i]}</span></div>`
    )
    .join("");

  $("opt1Desc").innerHTML =
    `<span class="inline-option-label">Option 1:</span>
     Known box &mdash; ${p100} out of 100 balls are ${name}.<br>
     Win $5 if a ball drawn from this box is ${name}, $0 otherwise.`;
  $("opt2Desc").innerHTML =
    `<span class="inline-option-label">Option 2:</span>
     Ambiguous box &mdash; an unknown number out of 100 balls are ${name}.<br>
     Win $5 if a ball drawn from the ambiguous box is ${name}, $0 otherwise.`;

  $("opt1Img").src = `assets/urn/risk/${d}/${d}_p${p100}.png`;
  $("opt2Img").src = `assets/urn/ambiguous/${d}.png`;

  selectOption(null);
  show("play");
}

/* ---------- choosing, and confirming ---------- */
function selectOption(which) {
  S.selected = which;
  $("option1Box").classList.toggle("selected", which === "option1");
  $("option2Box").classList.toggle("selected", which === "option2");
  $("nextBtn").disabled = which === null;
}

function showConfirmation() {
  if (!S.selected) return;
  const { name, p100 } = S.pending;
  $("confirmChoiceText").textContent =
    S.selected === "option1" ? "Option 1 (Known box)" : "Option 2 (Ambiguous box)";
  $("confirmDescription").innerHTML =
    `Winning color: ${name}<br>` +
    (S.selected === "option1"
      ? `You prefer a draw from a known box where ${p100} out of 100 are ${name}, rather than from
         the ambiguous box.`
      : `You prefer a draw from the ambiguous box, rather than from a known box where ${p100} out
         of 100 are ${name}.`);
  $("confirmModal").style.display = "flex";
}

function hideConfirmation() {
  $("confirmModal").style.display = "none";
}

function confirmChoice() {
  if (!S.selected) return;
  hideConfirmation();
  answer(S.selected === "option2" ? 1 : 0);   // option 2 is the ambiguous box
}

function answer(a) {
  S.answers.push(a);
  S.node = 2 * S.node + 1 + a;
  save();
  askNext();
}

/* ---------- results ---------- */
function showResults() {
  const m = S.man;
  const path = S.answers.reduce((acc, a, k) => acc + (a << (m.depth - 1 - k)), 0);
  const [, nPaths, nF, nE] = m.shape;
  const nC = m.p_curve.length;
  const shown = m.families_shown;

  const base = (S.pattern * nPaths + path) * nF;
  const mp = (f, e) => S.preds[(base + m.families.indexOf(f)) * nE + e] * m.scale;
  const cv = (f, j) => S.curve[(base + m.families.indexOf(f)) * nC + j] * m.scale;

  // the draws again, so the numbers can be read against the evidence behind them
  $("recallRow").innerHTML = m.colors
    .map(
      (c, i) =>
        `<div class="summary-item"><div class="summary-ball ${c}"></div>
         <span>${cap(m.event_names[c])} &times; ${S.counts[i]}</span></div>`
    )
    .join("");

  // one button per held-out bet, in color order, never merged
  const bets = [];
  for (let i = m.n_asked_events; i < m.events.length; i++) {
    bets.push({ i, code: displayEvent(m.events[i]), name: displayName(m.events[i]) });
  }
  const rank = (c) => m.colors.indexOf(c);
  bets.sort((a, b) => rank(a.code[0]) - rank(b.code[0]) ||
                      (a.code[1] ? rank(a.code[1]) - rank(b.code[1]) : 0));

  function predict(bet) {
    const rows = shown
      .map((f, k) => {
        const v = mp(f, bet.i);
        return `<div class="pred-row">
            <div class="chip" style="background:${CURVE_COLORS[k % CURVE_COLORS.length]}"></div>
            <div class="pred-name">${m.labels[f]}</div>
            <div class="pred-bar"><div style="width:${(v * 100).toFixed(1)}%"></div></div>
            <div class="pred-val">${v.toFixed(3)}</div>
          </div>`;
      })
      .join("");
    $("predBox").innerHTML =
      `<div class="pred-head">The <span class="has-tip">matching probability<span class="tip">The
         matching probability is the fraction of winning-color balls in the known box that would
         make you indifferent between betting that a winning color is drawn from the known box
         and from the ambiguous box.</span></span> for the event
         that one ball is drawn and its color is <b>${bet.name}</b></div>${rows}
       <div class="pred-foot">Both the smooth and the bridged Hurwicz model rely on a
         Bayesian-updating assumption for this estimation.</div>`;
    for (const b of $("pickOut").children) b.classList.toggle("on", +b.dataset.i === bet.i);
  }

  $("pickOut").innerHTML = bets
    .map((b) => `<button class="model" data-i="${b.i}">${b.name}</button>`)
    .join("");
  [...$("pickOut").children].forEach((b, k) =>
    b.addEventListener("click", () => predict(bets[k]))
  );

  const asked = m.events.slice(0, m.n_asked_events).map(displayName).sort();
  const held = bets.map((b) => b.name);

  $("poolLists").innerHTML =
    `<p><b>Could be asked (${asked.length}).</b> ${asked.join("; ")}.</p>
     <p><b>Kept out of the pool (${held.length}).</b> ${held.join("; ")}. No question can ask about
       these events. They are kept out of the question pool for out-of-sample prediction.</p>`;

  // the curve's model switcher: six lines on one axis are unreadable without one
  $("curveModels").innerHTML = shown
    .map(
      (f, k) =>
        `<button class="legend" data-f="${f}">
           <span style="color:${CURVE_COLORS[k % CURVE_COLORS.length]}">&#9632;</span>
           <span>${m.labels[f]}</span></button>`
    )
    .join("");
  for (const b of $("curveModels").children) {
    b.addEventListener("click", () => {
      const next = b.classList.contains("on") ? null : b.dataset.f;
      for (const x of $("curveModels").children) x.classList.toggle("on", x.dataset.f === next);
      S.curveReady.then(() => { if (S.curve) drawCurve(shown, cv, next); });
    });
  }

  predict(bets[0]);
  S.curveReady.then(() => { if (S.curve) drawCurve(shown, cv); });
  S.stage = "results";
  save();
  show("results");
}

/* ---------- the fitted curve ---------- */
function drawCurve(shown, cv, sel) {
  const m = S.man;
  const W = 620, H = 360, L = 52, R = 16, T = 16, B = 42;
  const px = (v) => L + v * (W - L - R);
  const py = (v) => H - B - v * (H - T - B);
  const colors = CURVE_COLORS;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  const grid = ticks
    .map(
      (t) =>
        `<line x1="${px(t)}" y1="${py(0)}" x2="${px(t)}" y2="${py(1)}" stroke="currentColor"
          stroke-opacity=".10"/>
         <line x1="${px(0)}" y1="${py(t)}" x2="${px(1)}" y2="${py(t)}" stroke="currentColor"
          stroke-opacity=".10"/>
         <text x="${px(t)}" y="${H - B + 17}" font-size="11" text-anchor="middle"
          fill="currentColor" opacity=".6">${t}</text>
         <text x="${L - 9}" y="${py(t) + 4}" font-size="11" text-anchor="end"
          fill="currentColor" opacity=".6">${t}</text>`
    )
    .join("");

  const diag = `<line x1="${px(0)}" y1="${py(0)}" x2="${px(1)}" y2="${py(1)}"
    stroke="currentColor" stroke-opacity=".35" stroke-dasharray="4 4"/>`;

  const lines = shown
    .map((f, i) => {
      const d = m.p_curve
        .map((pp, j) => `${j ? "L" : "M"}${px(pp).toFixed(1)},${py(cv(f, j)).toFixed(1)}`)
        .join(" ");
      const on = !sel || f === sel;
      return `<path d="${d}" fill="none" stroke="${colors[i % colors.length]}"
        stroke-width="${sel && on ? 3 : 2}" opacity="${on ? 1 : 0.18}"/>`;
    })
    .join("");


  $("plot").innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
       aria-label="Fitted matching probability against event probability">
       ${grid}${diag}${lines}
       <text x="${(L + W - R) / 2}" y="${H - 6}" font-size="12" text-anchor="middle"
         fill="currentColor" opacity=".75">subjective probability of the event</text>
       <text x="14" y="${(T + H - B) / 2}" font-size="12" text-anchor="middle" fill="currentColor"
         opacity=".75" transform="rotate(-90 14 ${(T + H - B) / 2})">matching probability</text>
     </svg>
     `;
}

/* ---------- plumbing ---------- */
function show(which) {
  for (const id of ["intro", "draw", "play", "results"]) $(id).hidden = id !== which;
  document.body.classList.toggle("playing", which === "play");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function restart() {
  clearSaved();
  S.node = 0;
  S.answers = [];
  S.asked = [];
  sampleBox();
  S.stage = "draw";
  save();
  show("draw");
  playDraw(true);
}

document.addEventListener("DOMContentLoaded", () => {
  $("start").addEventListener("click", () => {
    S.stage = "draw";
    save();
    show("draw");
    playDraw(true);
  });
  $("toq").addEventListener("click", () => askNext());

  for (const [box, btn, which] of [
    ["option1Box", "opt1Btn", "option1"],
    ["option2Box", "opt2Btn", "option2"],
  ]) {
    $(box).addEventListener("click", () => selectOption(which));
    $(btn).addEventListener("click", (e) => { e.stopPropagation(); selectOption(which); });
  }

  $("poolLink").addEventListener("click", (e) => {
    e.preventDefault();
    $("poolModal").style.display = "flex";
  });
  $("poolClose").addEventListener("click", () => ($("poolModal").style.display = "none"));
  $("poolModal").addEventListener("click", (e) => {
    if (e.target === $("poolModal")) $("poolModal").style.display = "none";
  });

  $("nextBtn").addEventListener("click", showConfirmation);
  $("goBackBtn").addEventListener("click", hideConfirmation);
  $("confirmBtn").addEventListener("click", confirmChoice);
  $("again").addEventListener("click", restart);
  boot().catch((e) => {
    // Opened as a file:// page the browser blocks the data fetches. Served over http it is fine.
    $("start").textContent =
      location.protocol === "file:"
        ? "Open this page through a web server, not as a file"
        : "Could not load the demo data";
    console.error(e);
  });
});
