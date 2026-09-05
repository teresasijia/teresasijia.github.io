/* demo.js -- the elicitation game.
 *
 * No model arithmetic here. The tree fixes the questions and never sees the draws, so one tree
 * serves every sample; estimation was enumerated offline for all six draw patterns. The page
 * samples a box, walks a heap, builds an answer index, and reads two tables.
 *
 *   node <- 2 * node + 1 + answer            walk the tree to the next question
 *   path <- sum(answer_k << (depth-1-k))     first answer is the most significant bit
 *
 * The box follows Study 2: the composition multiset {10,20,30,40} is permuted across colours, and
 * the draw history is SAMPLED from it. So the permutation belongs to the composition, not to the
 * draws. Because every model here is colour-exchangeable, the sampled counts are looked up as
 * (sorted pattern, colour permutation) -- an indexing device, not a claim about the design.
 */

const S = {
  man: null, tree: null, preds: null, curve: null,
  node: 0, answers: [], asked: [],
  counts: null, pattern: 0, perm: null, draws: [],
};

const $ = (id) => document.getElementById(id);

async function boot() {
  const [man, tree, preds, curve] = await Promise.all([
    fetch("assets/demo_manifest.json").then((r) => r.json()),
    fetch("assets/tree.bin").then((r) => r.arrayBuffer()),
    fetch("assets/predictions.bin").then((r) => r.arrayBuffer()),
    fetch("assets/curve.bin").then((r) => r.arrayBuffer()),
  ]);
  S.man = man;
  S.tree = new Int16Array(tree);
  S.preds = new Uint16Array(preds);
  S.curve = new Uint16Array(curve);
  sampleBox();
  $("start").disabled = false;
  $("start").textContent = `Start — ${man.depth} questions, about two minutes`;
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
  const weights = shuffled(m.composition_multiset); // composition, permuted across colours
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

  // Index the precomputed tables: sort colours by descending count to get the pattern, and keep
  // the ordering as the permutation from canonical slot to displayed colour.
  const order = [0, 1, 2, 3].sort((a, b) => counts[b] - counts[a] || a - b);
  const sorted = order.map((i) => counts[i]);
  S.counts = counts;
  S.perm = order;
  S.pattern = m.draw_patterns.findIndex((p) => p.every((v, i) => v === sorted[i]));
  renderUrn();
}

/* Canonical colour k is displayed as colour perm[k], so a canonical event code maps letter by
   letter. Every model is colour-exchangeable, so this is a pure relabelling. */
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
  $("urn").innerHTML = S.draws
    .map((k) => `<span class="ball ${S.man.colors[k]}"></span>`)
    .join("");
}

/* ---------- questions ---------- */
function question(node) {
  const j = S.tree[node];
  const nP = S.man.n_probes;
  return { event: S.man.events[Math.floor(j / nP)], q: (j % nP) / (nP - 1) };
}

function askNext() {
  const k = S.answers.length;
  if (k === S.man.depth) return showResults();

  const { event, q } = question(S.node);
  S.asked.push(event);

  $("qnum").textContent = `Question ${k + 1} of ${S.man.depth}`;
  $("qbar").style.width = `${(k / S.man.depth) * 100}%`;
  $("qtext").textContent =
    "A ball will be drawn from the same box. Which bet would you rather hold?";
  $("optA").innerHTML =
    `<b>Bet on the box</b><br><span class="muted small">You win if the ball is
     ${displayName(event)}.</span>`;
  $("optB").innerHTML =
    `<b>Bet on a known chance</b><br><span class="muted small">You win with probability
     ${(q * 100).toFixed(0)}%.</span>`;
  show("play");
}

function answer(a) {
  S.answers.push(a);
  S.node = 2 * S.node + 1 + a;
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
  const cv = (f, j) =>
    S.curve[((S.pattern * nPaths + path) * nF + m.families.indexOf(f)) * nC + j] * m.scale;

  const nAsked = m.n_asked_events;
  const askedSet = new Set(S.asked);
  const head = `<tr><th>You win if the ball is</th>${shown
    .map((f) => `<th>${m.labels[f]}</th>`)
    .join("")}</tr>`;

  /* Bets that are equivalent given the draws you saw carry identical numbers, because they ARE
     the same bet: with four colours no draw count below 7 can make all six two-colour bets
     distinct. Grouping them says so, rather than printing the same row three times. */
  function groupedRows(from, to, mark) {
    const groups = new Map();
    for (let i = from; i < to; i++) {
      const vals = shown.map((f) => mp(f, i).toFixed(3));
      const key = vals.join("|");
      if (!groups.has(key)) groups.set(key, { vals, names: [] });
      const e = m.events[i];
      groups.get(key).names.push(
        displayName(e) + (mark && askedSet.has(e) ? ' <span class="small">(asked)</span>' : "")
      );
    }
    return [...groups.values()]
      .map(
        (g) =>
          `<tr><td>${g.names.join(" &middot; ")}</td>` +
          g.vals.map((v) => `<td>${v}</td>`).join("") +
          `</tr>`
      )
      .join("");
  }

  $("thead_out").innerHTML = head;
  $("tbody_out").innerHTML = groupedRows(nAsked, m.events.length, false);
  $("thead_in").innerHTML = head;
  $("tbody_in").innerHTML = groupedRows(0, nAsked, true);

  const nGroups = new Set(
    m.events.slice(nAsked).map((_, k) => shown.map((f) => mp(f, nAsked + k).toFixed(3)).join("|"))
  ).size;
  $("heldnote").innerHTML =
    `Every question you answered was about a single colour, or about three colours at once. You ` +
    `were never offered a two-colour bet &mdash; not once, and no sequence of answers could have ` +
    `led to one. Those ${m.held_out_events.length} bets are pure prediction.` +
    (nGroups < m.held_out_events.length
      ? ` They are shown as ${nGroups} rows because your draws leave some of them indistinguishable:
         with the same evidence behind each, the models cannot tell them apart, and neither
         should you.`
      : "");

  drawCurve(shown, cv);
  $("qbar").style.width = "100%";
  show("results");
}

/* ---------- the fitted curve ---------- */
function drawCurve(shown, cv) {
  const m = S.man;
  const W = 620, H = 360, L = 52, R = 16, T = 16, B = 42;
  const px = (v) => L + v * (W - L - R);
  const py = (v) => H - B - v * (H - T - B);
  const colors = ["#7a2d2d", "#2f6f8f", "#57813f", "#946a1f", "#6a4a86", "#8f5a2f"];
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
      return `<path d="${d}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="2"/>`;
    })
    .join("");

  const legend = shown
    .map(
      (f, i) =>
        `<span style="color:${colors[i % colors.length]}">&#9632;</span>
         <span class="small">${m.labels[f]}</span>`
    )
    .join(" &nbsp; ");

  $("plot").innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
       aria-label="Fitted matching probability against event probability">
       ${grid}${diag}${lines}
       <text x="${(L + W - R) / 2}" y="${H - 6}" font-size="12" text-anchor="middle"
         fill="currentColor" opacity=".75">probability of the event</text>
       <text x="14" y="${(T + H - B) / 2}" font-size="12" text-anchor="middle" fill="currentColor"
         opacity=".75" transform="rotate(-90 14 ${(T + H - B) / 2})">matching probability</text>
     </svg>
     <div style="margin-top:8px">${legend}
       <span class="small muted">&nbsp; dashed = ambiguity neutrality</span></div>`;
}

/* ---------- plumbing ---------- */
function show(which) {
  for (const id of ["intro", "play", "results"]) $(id).hidden = id !== which;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function restart() {
  S.node = 0;
  S.answers = [];
  S.asked = [];
  sampleBox();
  askNext();
}

document.addEventListener("DOMContentLoaded", () => {
  $("start").addEventListener("click", () => askNext());
  $("optA").addEventListener("click", () => answer(1)); // chose the ambiguous box
  $("optB").addEventListener("click", () => answer(0)); // chose the known chance
  $("again").addEventListener("click", restart);
  boot().catch((e) => {
    $("start").textContent = "Could not load the demo data";
    console.error(e);
  });
});
