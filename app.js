"use strict";

const LETTERS = ["A", "B", "C", "D", "E"];
const STORAGE_PREFIX = "renalqbank_brick_";
const VALID_MODES = ["basic", "nbme"];
const MODE_LABELS = { basic: "Basic", nbme: "NBME-tier" };

/* ============ Storage helpers ============ */
function storageKey(brickId, mode) {
  return STORAGE_PREFIX + brickId + "_" + mode;
}

function loadProgress(brickId, mode) {
  try {
    const raw = localStorage.getItem(storageKey(brickId, mode));
    if (!raw) return { answers: {}, current: 0 };
    const parsed = JSON.parse(raw);
    return {
      answers: parsed.answers || {},
      current: typeof parsed.current === "number" ? parsed.current : 0,
    };
  } catch (e) {
    return { answers: {}, current: 0 };
  }
}

function saveProgress(brickId, mode, progress) {
  localStorage.setItem(storageKey(brickId, mode), JSON.stringify(progress));
}

function clearProgress(brickId, mode) {
  localStorage.removeItem(storageKey(brickId, mode));
}

function clearAllProgress() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}

function progressStats(progress, total) {
  const answered = Object.keys(progress.answers).length;
  let correct = 0;
  for (const k in progress.answers) {
    if (progress.answers[k].correct) correct++;
  }
  const percent = answered === 0 ? null : Math.round((correct / answered) * 100);
  return { answered, correct, total, percent };
}

function brickFilePath(brickId, mode) {
  return mode === "nbme"
    ? `data/brick-${brickId}-nbme.json`
    : `data/brick-${brickId}.json`;
}

/* ============ Home page ============ */
async function renderHome() {
  const grid = document.getElementById("brick-grid");
  if (!grid) return;

  let manifest;
  try {
    const res = await fetch("manifest.json", { cache: "no-store" });
    manifest = await res.json();
  } catch (e) {
    grid.innerHTML = '<div class="notice">Failed to load manifest.</div>';
    return;
  }

  const sorted = [...manifest.bricks].sort((a, b) => a.id - b.id);
  grid.innerHTML = "";

  for (const brick of sorted) {
    const modes = brick.modes || { basic: !!brick.available, nbme: false };
    const card = document.createElement("article");
    card.className = "brick-card";
    card.innerHTML = `
      <div class="brick-card-top">
        <span class="brick-number">Brick ${brick.id}</span>
      </div>
      <h3 class="brick-title">${escapeHtml(brick.title)}</h3>
      <div class="mode-buttons" data-brick-id="${brick.id}"></div>
    `;
    const modeContainer = card.querySelector(".mode-buttons");

    for (const mode of VALID_MODES) {
      const enabled = !!modes[mode];
      const total = 25;
      const progress = enabled ? loadProgress(brick.id, mode) : { answers: {}, current: 0 };
      const stats = progressStats(progress, total);

      if (enabled) {
        const link = document.createElement("a");
        link.className = "mode-btn mode-" + mode;
        link.href = `quiz.html?brick=${brick.id}&mode=${mode}`;
        link.innerHTML = `
          <div class="mode-btn-row">
            <span class="mode-btn-label">${MODE_LABELS[mode]}</span>
            <span class="mode-btn-stats">${
              stats.answered === 0
                ? "Not started"
                : stats.answered === total
                ? `${stats.correct}/${total} · ${stats.percent}%`
                : `${stats.answered}/${total} · ${stats.percent === null ? "—" : stats.percent + "%"}`
            }</span>
          </div>
          <div class="progress-bar">
            <div class="progress-bar-fill" style="width:${total ? (stats.answered / total) * 100 : 0}%"></div>
          </div>
        `;
        modeContainer.appendChild(link);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "mode-btn mode-" + mode + " disabled";
        placeholder.innerHTML = `
          <div class="mode-btn-row">
            <span class="mode-btn-label">${MODE_LABELS[mode]}</span>
            <span class="mode-btn-stats">Coming soon</span>
          </div>
          <div class="progress-bar"><div class="progress-bar-fill" style="width:0%"></div></div>
        `;
        modeContainer.appendChild(placeholder);
      }
    }

    grid.appendChild(card);
  }

  const resetBtn = document.getElementById("reset-all");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (confirm("Reset progress for all bricks (both modes)?")) {
        clearAllProgress();
        renderHome();
      }
    });
  }
}

/* ============ Quiz page ============ */
async function renderQuiz() {
  const params = new URLSearchParams(window.location.search);
  const brickId = parseInt(params.get("brick"), 10);
  const modeParam = params.get("mode");
  const mode = VALID_MODES.includes(modeParam) ? modeParam : "basic";
  const titleEl = document.getElementById("brick-title");
  const counterEl = document.getElementById("question-counter");
  const area = document.getElementById("question-area");
  const paletteEl = document.getElementById("palette");
  const modeBadge = document.getElementById("mode-badge");

  if (!brickId || isNaN(brickId)) {
    area.innerHTML = '<div class="notice">No brick selected. <a href="index.html">Back to bricks</a>.</div>';
    return;
  }

  let brick;
  try {
    const res = await fetch(brickFilePath(brickId, mode), { cache: "no-store" });
    if (!res.ok) throw new Error("missing");
    brick = await res.json();
  } catch (e) {
    area.innerHTML = '<div class="notice">This brick is not available yet for ' + MODE_LABELS[mode] + ' mode. <a href="index.html">Back to bricks</a>.</div>';
    return;
  }

  titleEl.textContent = `Brick ${brick.id}: ${brick.title}`;
  if (modeBadge) {
    modeBadge.textContent = MODE_LABELS[mode];
    modeBadge.classList.add("mode-" + mode);
  }

  const state = {
    brick,
    mode,
    progress: loadProgress(brick.id, mode),
    lastRenderedId: null,
  };

  if (state.progress.current >= brick.questions.length || state.progress.current < 0) {
    state.progress.current = 0;
  }

  function commit() {
    saveProgress(brick.id, mode, state.progress);
  }

  function jumpTo(index) {
    state.progress.current = index;
    commit();
    renderQuestion();
    renderPalette(state, paletteEl, jumpTo);
    updateCounter(state, counterEl);
  }

  function advance() {
    if (state.progress.current < brick.questions.length - 1) {
      state.progress.current += 1;
      commit();
      renderQuestion();
      renderPalette(state, paletteEl, jumpTo);
      updateCounter(state, counterEl);
    } else {
      const firstUnanswered = brick.questions.findIndex(
        (q) => !(q.id in state.progress.answers)
      );
      if (firstUnanswered === -1) {
        renderSummary(state, area);
      } else {
        jumpTo(firstUnanswered);
      }
    }
  }

  function renderQuestion() {
    const q = state.brick.questions[state.progress.current];
    const isNewQuestion = state.lastRenderedId !== q.id;
    state.lastRenderedId = q.id;
    drawQuestion(state, q, area, advance, jumpTo, paletteEl, counterEl, isNewQuestion);
  }

  // Initial render
  updateScoreBadge(state, false);
  updateCounter(state, counterEl);
  renderPalette(state, paletteEl, jumpTo);
  const allAnswered = brick.questions.every((q) => q.id in state.progress.answers);
  if (allAnswered) {
    renderSummary(state, area);
  } else {
    renderQuestion();
  }

  const resetBtn = document.getElementById("reset-brick");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (confirm("Reset progress for this brick (" + MODE_LABELS[mode] + ")?")) {
        clearProgress(brick.id, mode);
        state.progress = { answers: {}, current: 0 };
        state.lastRenderedId = null;
        commit();
        updateCounter(state, counterEl);
        renderPalette(state, paletteEl, jumpTo);
        updateScoreBadge(state, false);
        renderQuestion();
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    const q = brick.questions[state.progress.current];
    if (!q) return;
    const answered = q.id in state.progress.answers;
    if (!answered && /^[1-5]$/.test(e.key)) {
      const idx = parseInt(e.key, 10) - 1;
      const btn = area.querySelector(`.choice[data-index="${idx}"]`);
      if (btn) btn.click();
    } else if (answered && (e.key === "Enter" || e.key === "ArrowRight" || e.key === " ")) {
      e.preventDefault();
      const next = area.querySelector("#next-btn");
      if (next) next.click();
    } else if (e.key === "ArrowLeft") {
      if (state.progress.current > 0) jumpTo(state.progress.current - 1);
    }
  });
}

function drawQuestion(state, q, area, advance, jumpTo, paletteEl, counterEl, isNewQuestion) {
  const existing = state.progress.answers[q.id];

  area.innerHTML = "";
  area.classList.remove("no-anim");
  if (isNewQuestion) {
    void area.offsetWidth;
  } else {
    area.classList.add("no-anim");
  }

  const stem = document.createElement("p");
  stem.className = "question-stem";
  stem.textContent = q.stem;
  area.appendChild(stem);

  // Optional labs table
  if (q.labs && Array.isArray(q.labs) && q.labs.length > 0) {
    const labsCard = document.createElement("div");
    labsCard.className = "labs-card";
    const labsTitle = document.createElement("div");
    labsTitle.className = "labs-title";
    labsTitle.textContent = q.labs_title || "Laboratory studies";
    labsCard.appendChild(labsTitle);

    const table = document.createElement("table");
    table.className = "labs-table";
    const tbody = document.createElement("tbody");
    q.labs.forEach((lab) => {
      const tr = document.createElement("tr");
      const tdName = document.createElement("td");
      tdName.className = "labs-name";
      tdName.textContent = lab.name;
      const tdValue = document.createElement("td");
      tdValue.className = "labs-value";
      const flag = lab.flag === "high" ? " ↑" : lab.flag === "low" ? " ↓" : "";
      tdValue.innerHTML = escapeHtml(lab.value) + (flag ? `<span class="labs-flag flag-${lab.flag}">${flag}</span>` : "");
      const tdRef = document.createElement("td");
      tdRef.className = "labs-ref";
      tdRef.textContent = lab.ref || "";
      tr.appendChild(tdName);
      tr.appendChild(tdValue);
      tr.appendChild(tdRef);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    labsCard.appendChild(table);
    area.appendChild(labsCard);
  }

  // Optional diagram (raw SVG/HTML — content authored, trusted)
  if (q.diagram) {
    const diagramWrap = document.createElement("div");
    diagramWrap.className = "diagram-card";
    diagramWrap.innerHTML = q.diagram;
    area.appendChild(diagramWrap);
  }

  const list = document.createElement("div");
  list.className = "choices";
  const choiceButtons = [];

  q.choices.forEach((text, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice";
    btn.dataset.index = String(idx);

    const letter = document.createElement("span");
    letter.className = "choice-letter";
    letter.textContent = LETTERS[idx];

    const body = document.createElement("span");
    body.className = "choice-body";

    const choiceText = document.createElement("span");
    choiceText.className = "choice-text";
    choiceText.textContent = text;
    body.appendChild(choiceText);

    const exp = document.createElement("span");
    exp.className = "choice-explanation";
    const expInner = document.createElement("span");
    expInner.className = "choice-explanation-inner";
    expInner.textContent = q.explanations[idx] || "";
    exp.appendChild(expInner);
    body.appendChild(exp);

    btn.appendChild(letter);
    btn.appendChild(body);

    btn.addEventListener("click", () => {
      if (q.id in state.progress.answers) return;
      const correct = idx === q.answer;
      state.progress.answers[q.id] = { selected: idx, correct };
      saveProgress(state.brick.id, state.mode, state.progress);
      lockChoices(idx, true);
      updateScoreBadge(state, true);
      renderPalette(state, paletteEl, jumpTo);
    });

    choiceButtons.push(btn);
    list.appendChild(btn);
  });

  area.appendChild(list);

  function lockChoices(selectedIdx, animate) {
    const apply = () => {
      choiceButtons.forEach((btn, idx) => {
        btn.classList.add("locked");
        btn.disabled = true;
        if (idx === q.answer) btn.classList.add("correct");
        if (idx === selectedIdx && idx !== q.answer) btn.classList.add("incorrect", "selected");
        if (idx === selectedIdx && idx === q.answer) btn.classList.add("selected");
      });
      addFeedbackRow(selectedIdx === q.answer, animate);
    };

    if (animate) {
      requestAnimationFrame(apply);
    } else {
      area.classList.add("no-anim");
      apply();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => area.classList.remove("no-anim"));
      });
    }
  }

  function addFeedbackRow(isCorrect, animate) {
    const existingRow = area.querySelector(".feedback-row");
    if (existingRow) existingRow.remove();

    const row = document.createElement("div");
    row.className = "feedback-row";
    if (!animate) row.style.animation = "none";

    const fb = document.createElement("div");
    fb.className = "feedback-text " + (isCorrect ? "correct" : "incorrect");
    fb.textContent = isCorrect ? "Correct" : "Incorrect";
    row.appendChild(fb);

    const isLast = state.progress.current === state.brick.questions.length - 1;
    const allDone = state.brick.questions.every((qq) => qq.id in state.progress.answers);

    const next = document.createElement("button");
    next.type = "button";
    next.id = "next-btn";
    next.className = "btn";
    next.textContent = isLast ? (allDone ? "View summary" : "Next unanswered") : "Next question";
    next.addEventListener("click", advance);
    row.appendChild(next);

    area.appendChild(row);
  }

  if (existing) {
    lockChoices(existing.selected, false);
  }
}

function updateScoreBadge(state, pulse) {
  const stats = progressStats(state.progress, state.brick.questions.length);
  const badge = document.getElementById("score-badge");
  const fractionEl = document.getElementById("score-fraction");
  const percentEl = document.getElementById("score-percent");
  if (fractionEl) fractionEl.textContent = `${stats.correct}/${stats.answered}`;
  if (percentEl) percentEl.textContent = stats.percent === null ? "—" : `${stats.percent}%`;
  if (pulse && badge) {
    badge.classList.remove("pulse");
    void badge.offsetWidth;
    badge.classList.add("pulse");
  }
}

function updateCounter(state, el) {
  if (!el) return;
  el.textContent = `Question ${state.progress.current + 1} of ${state.brick.questions.length}`;
}

function renderPalette(state, paletteEl, jumpTo) {
  if (!paletteEl) return;
  paletteEl.innerHTML = "";
  state.brick.questions.forEach((q, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "palette-btn";
    btn.textContent = idx + 1;
    if (idx === state.progress.current) btn.classList.add("current");
    const ans = state.progress.answers[q.id];
    if (ans) {
      btn.classList.add(ans.correct ? "correct" : "incorrect");
    }
    btn.addEventListener("click", () => jumpTo(idx));
    paletteEl.appendChild(btn);
  });
}

function renderSummary(state, area) {
  const stats = progressStats(state.progress, state.brick.questions.length);
  area.innerHTML = `
    <div class="summary-card">
      <h2>Brick complete</h2>
      <div class="summary-score">${stats.correct} / ${state.brick.questions.length}</div>
      <div class="summary-percent">${stats.percent}% correct</div>
      <div class="summary-actions">
        <button id="review-btn" class="btn btn-ghost">Review questions</button>
        <button id="restart-btn" class="btn">Restart brick</button>
      </div>
    </div>
  `;
  document.getElementById("review-btn").addEventListener("click", () => {
    state.progress.current = 0;
    saveProgress(state.brick.id, state.mode, state.progress);
    location.reload();
  });
  document.getElementById("restart-btn").addEventListener("click", () => {
    if (confirm("Restart this brick? This clears your answers.")) {
      clearProgress(state.brick.id, state.mode);
      location.reload();
    }
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
