"use strict";

const LETTERS = ["A", "B", "C", "D", "E"];
const STORAGE_PREFIX = "renalqbank_brick_";

/* ============ Storage helpers ============ */
function loadProgress(brickId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + brickId);
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

function saveProgress(brickId, progress) {
  localStorage.setItem(STORAGE_PREFIX + brickId, JSON.stringify(progress));
}

function clearProgress(brickId) {
  localStorage.removeItem(STORAGE_PREFIX + brickId);
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
    if (!brick.available) {
      const card = document.createElement("div");
      card.className = "brick-card disabled";
      card.innerHTML = `
        <div class="brick-card-top">
          <span class="brick-number">Brick ${brick.id}</span>
          <span class="brick-status">Coming soon</span>
        </div>
        <h3 class="brick-title">${escapeHtml(brick.title)}</h3>
      `;
      grid.appendChild(card);
      continue;
    }

    const progress = loadProgress(brick.id);
    const total = 25;
    const stats = progressStats(progress, total);

    const card = document.createElement("a");
    card.className = "brick-card";
    card.href = `quiz.html?brick=${brick.id}`;

    const statusLabel =
      stats.answered === 0
        ? "Not started"
        : stats.answered === total
        ? "Completed"
        : `${stats.answered}/${total} answered`;

    card.innerHTML = `
      <div class="brick-card-top">
        <span class="brick-number">Brick ${brick.id}</span>
        <span class="brick-status${stats.answered === total ? " completed" : ""}">${statusLabel}</span>
      </div>
      <h3 class="brick-title">${escapeHtml(brick.title)}</h3>
      <div class="brick-progress">
        <div class="progress-row">
          <span>${stats.correct}/${stats.answered || 0} correct</span>
          <span>${stats.percent === null ? "—" : stats.percent + "%"}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-bar-fill" style="width:${total ? (stats.answered / total) * 100 : 0}%"></div>
        </div>
      </div>
    `;
    grid.appendChild(card);
  }

  const resetBtn = document.getElementById("reset-all");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (confirm("Reset progress for all bricks?")) {
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
  const titleEl = document.getElementById("brick-title");
  const counterEl = document.getElementById("question-counter");
  const area = document.getElementById("question-area");
  const paletteEl = document.getElementById("palette");

  if (!brickId || isNaN(brickId)) {
    area.innerHTML = '<div class="notice">No brick selected. <a href="index.html">Back to bricks</a>.</div>';
    return;
  }

  let brick;
  try {
    const res = await fetch(`data/brick-${brickId}.json`, { cache: "no-store" });
    if (!res.ok) throw new Error("missing");
    brick = await res.json();
  } catch (e) {
    area.innerHTML = '<div class="notice">This brick is not available yet. <a href="index.html">Back to bricks</a>.</div>';
    return;
  }

  titleEl.textContent = `Brick ${brick.id}: ${brick.title}`;

  const state = {
    brick,
    progress: loadProgress(brick.id),
    lastRenderedId: null,
  };

  if (state.progress.current >= brick.questions.length || state.progress.current < 0) {
    state.progress.current = 0;
  }

  function commit() {
    saveProgress(brick.id, state.progress);
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

  // Reset brick button
  const resetBtn = document.getElementById("reset-brick");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (confirm("Reset progress for this brick?")) {
        clearProgress(brick.id);
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

  // Keyboard shortcuts
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

/* Build the question DOM. If isNewQuestion, animate entrance.
   The choices start unlocked even if previously answered, then we
   apply locked state either immediately (no anim) or via class toggle (anim). */
function drawQuestion(state, q, area, advance, jumpTo, paletteEl, counterEl, isNewQuestion) {
  const existing = state.progress.answers[q.id];

  area.innerHTML = "";
  area.classList.remove("no-anim");
  // Force reflow + restart the entrance animation when navigating
  if (isNewQuestion) {
    void area.offsetWidth;
  } else {
    area.classList.add("no-anim");
  }

  const stem = document.createElement("p");
  stem.className = "question-stem";
  stem.textContent = q.stem;
  area.appendChild(stem);

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
      saveProgress(state.brick.id, state.progress);
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
      // Defer one frame so the transition fires.
      requestAnimationFrame(apply);
    } else {
      // Apply instantly with no animation, then restore transitions.
      area.classList.add("no-anim");
      apply();
      // Force layout to commit the locked styles, then re-enable transitions.
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

  // If already answered (e.g. navigated back), apply locked state instantly.
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
    void badge.offsetWidth; // restart animation
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
    saveProgress(state.brick.id, state.progress);
    location.reload();
  });
  document.getElementById("restart-btn").addEventListener("click", () => {
    if (confirm("Restart this brick? This clears your answers.")) {
      clearProgress(state.brick.id);
      location.reload();
    }
  });
}

/* ============ Util ============ */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
