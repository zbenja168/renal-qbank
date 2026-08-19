"use strict";

const LETTERS = ["A", "B", "C", "D", "E"];
const STORAGE_PREFIX = "renalqbank_brick_";
const MIX_SELECTION_KEY = "renalqbank_mix_selection";
const MISSED_BRICK_ID = "missed";
const QUESTIONS_PER_BRICK = 25;
const WEEK_1_BRICKS = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21];
const WEEK_2_BRICKS = [22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39];
const WEEK_3_BRICKS = [40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55];
const WEEK_4_BRICKS = [56,57,58,59,60,61,62,63,64,65];

/* ============ Storage helpers ============ */
function storageKey(brickId) {
  return STORAGE_PREFIX + brickId + "_basic";
}

function mixSessionId(brickIds) {
  return "mix-" + [...brickIds].sort((a, b) => a - b).join("-");
}

function loadMixSelection() {
  try {
    const raw = localStorage.getItem(MIX_SELECTION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => Number.isInteger(n)) : [];
  } catch (e) {
    return [];
  }
}

function saveMixSelection(ids) {
  if (ids.length === 0) {
    localStorage.removeItem(MIX_SELECTION_KEY);
  } else {
    localStorage.setItem(MIX_SELECTION_KEY, JSON.stringify(ids));
  }
}

function loadProgress(brickId) {
  try {
    const raw = localStorage.getItem(storageKey(brickId));
    if (!raw) return { answers: {}, current: 0 };
    const parsed = JSON.parse(raw);
    const out = {
      answers: parsed.answers || {},
      current: typeof parsed.current === "number" ? parsed.current : 0,
    };
    if (Array.isArray(parsed.order)) out.order = parsed.order;
    return out;
  } catch (e) {
    return { answers: {}, current: 0 };
  }
}

function saveProgress(brickId, progress) {
  localStorage.setItem(storageKey(brickId), JSON.stringify(progress));
}

function clearProgress(brickId) {
  localStorage.removeItem(storageKey(brickId));
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

function brickFilePath(brickId) {
  return `data/brick-${brickId}.json`;
}

function collectMissedFromStorage() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX) || !key.endsWith("_basic")) continue;
    const middle = key.slice(STORAGE_PREFIX.length, -"_basic".length);
    const brickId = parseInt(middle, 10);
    if (!Number.isInteger(brickId) || brickId <= 0) continue;
    let parsed;
    try { parsed = JSON.parse(localStorage.getItem(key)); } catch (e) { continue; }
    if (!parsed || !parsed.answers) continue;
    for (const qid in parsed.answers) {
      if (parsed.answers[qid] && parsed.answers[qid].correct === false) {
        out.push({ brickId, qid });
      }
    }
  }
  return out;
}

async function buildMissedBrick() {
  const missed = collectMissedFromStorage();
  if (missed.length === 0) return null;

  const uniqueBrickIds = [...new Set(missed.map((m) => m.brickId))];
  const sourceBricks = await Promise.all(
    uniqueBrickIds.map((id) =>
      loadBrickJson(id).then((b) => ({ id, brick: b })).catch(() => ({ id, brick: null }))
    )
  );
  const brickById = new Map(sourceBricks.filter((b) => b.brick).map((b) => [b.id, b.brick]));

  const allQuestions = [];
  for (const m of missed) {
    const sourceBrick = brickById.get(m.brickId);
    if (!sourceBrick) continue;
    const srcQ = sourceBrick.questions.find((q) => String(q.id) === String(m.qid));
    if (!srcQ) continue;
    allQuestions.push({
      ...srcQ,
      id: `${m.brickId}-${srcQ.id}`,
      sourceBrickId: m.brickId,
      sourceBrickTitle: sourceBrick.title,
      sourceQId: srcQ.id,
    });
  }
  if (allQuestions.length === 0) return null;

  const stored = loadProgress(MISSED_BRICK_ID);
  const storedOrderIds = Array.isArray(stored.orderIds) ? stored.orderIds : null;
  const currentIds = allQuestions.map((q) => q.id);

  let questions;
  if (
    storedOrderIds &&
    storedOrderIds.length === currentIds.length &&
    storedOrderIds.every((id) => currentIds.includes(id))
  ) {
    const byId = new Map(allQuestions.map((q) => [q.id, q]));
    questions = storedOrderIds.map((id) => byId.get(id)).filter(Boolean);
  } else {
    shuffleInPlace(allQuestions);
    questions = allQuestions;
    saveProgress(MISSED_BRICK_ID, {
      ...stored,
      orderIds: questions.map((q) => q.id),
      current: 0,
    });
  }

  return {
    id: MISSED_BRICK_ID,
    title: `Missed questions · ${questions.length}`,
    questions,
    isMixed: true,
    isMissed: true,
  };
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
  const availableIds = new Set(sorted.filter((b) => b.available !== false).map((b) => b.id));

  const selection = new Set(loadMixSelection().filter((id) => availableIds.has(id)));

  function refreshMissedBanner() {
    const banner = document.getElementById("missed-banner");
    if (!banner) return;
    const missedCount = collectMissedFromStorage().filter((m) => availableIds.has(m.brickId)).length;
    if (missedCount === 0) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    const countEl = document.getElementById("missed-count");
    if (countEl) countEl.textContent = String(missedCount);
  }

  refreshMissedBanner();

  const missedStartBtn = document.getElementById("missed-start");
  if (missedStartBtn) {
    missedStartBtn.addEventListener("click", () => {
      clearProgress(MISSED_BRICK_ID);
      window.location.href = "quiz.html?missed=1";
    });
  }

  function refreshMixBar() {
    const bar = document.getElementById("mix-bar");
    const count = document.getElementById("mix-count");
    const qcount = document.getElementById("mix-q-count");
    const startBtn = document.getElementById("mix-start");
    if (!bar) return;
    const n = selection.size;
    if (n === 0) {
      bar.hidden = true;
    } else {
      bar.hidden = false;
      if (count) count.textContent = String(n);
      if (qcount) qcount.textContent = String(n * QUESTIONS_PER_BRICK);
      if (startBtn) startBtn.disabled = n < 1;
    }
    saveMixSelection([...selection]);
  }

  function setSelected(id, selected, btn, card) {
    if (selected) selection.add(id);
    else selection.delete(id);
    if (btn) {
      btn.classList.toggle("selected", selected);
      btn.textContent = selected ? "✓" : "+";
      btn.setAttribute("aria-pressed", String(selected));
      btn.setAttribute("aria-label", selected ? "Remove from mixed quiz" : "Add to mixed quiz");
    }
    if (card) card.classList.toggle("mix-selected", selected);
    refreshMixBar();
  }

  function renderCards() {
    grid.innerHTML = "";
    for (const brick of sorted) {
      const total = QUESTIONS_PER_BRICK;
      const progress = loadProgress(brick.id);
      const stats = progressStats(progress, total);
      const isSelected = selection.has(brick.id);

      const card = document.createElement("article");
      card.className = "brick-card" + (isSelected ? " mix-selected" : "");

      const top = document.createElement("div");
      top.className = "brick-card-top";

      const num = document.createElement("span");
      num.className = "brick-number";
      num.textContent = `Brick ${brick.id}`;
      top.appendChild(num);

      const checkbox = document.createElement("button");
      checkbox.type = "button";
      checkbox.className = "mix-select" + (isSelected ? " selected" : "");
      checkbox.textContent = isSelected ? "✓" : "+";
      checkbox.setAttribute("aria-pressed", String(isSelected));
      checkbox.setAttribute("aria-label", isSelected ? "Remove from mixed quiz" : "Add to mixed quiz");
      checkbox.title = "Add to mixed quiz";
      checkbox.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setSelected(brick.id, !selection.has(brick.id), checkbox, card);
      });
      top.appendChild(checkbox);
      card.appendChild(top);

      const title = document.createElement("h3");
      title.className = "brick-title";
      title.textContent = brick.title;
      card.appendChild(title);

      const link = document.createElement("a");
      link.className = "brick-start-btn";
      link.href = `quiz.html?brick=${brick.id}`;
      link.innerHTML = `
        <div class="brick-start-row">
          <span class="brick-start-label">Start</span>
          <span class="brick-start-stats">${
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
      card.appendChild(link);

      grid.appendChild(card);
    }
  }

  renderCards();
  refreshMixBar();

  function selectIds(ids) {
    selection.clear();
    ids.filter((id) => availableIds.has(id)).forEach((id) => selection.add(id));
    renderCards();
    refreshMixBar();
  }

  const wireBulk = (id, ids) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", () => selectIds(ids));
  };
  wireBulk("select-week-1", WEEK_1_BRICKS);
  wireBulk("select-week-2", WEEK_2_BRICKS);
  wireBulk("select-week-3", WEEK_3_BRICKS);
  wireBulk("select-week-4", WEEK_4_BRICKS);
  wireBulk("select-all", [...availableIds]);
  wireBulk("select-clear", []);

  const mixClearBtn = document.getElementById("mix-clear");
  if (mixClearBtn) mixClearBtn.addEventListener("click", () => selectIds([]));

  const mixStartBtn = document.getElementById("mix-start");
  if (mixStartBtn) {
    mixStartBtn.addEventListener("click", () => {
      if (selection.size === 0) return;
      const ids = [...selection].sort((a, b) => a - b).join(",");
      window.location.href = `quiz.html?bricks=${ids}`;
    });
  }

  const resetBtn = document.getElementById("reset-all");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (confirm("Reset progress for all bricks?")) {
        clearAllProgress();
        renderCards();
      }
    });
  }
}

/* ============ Quiz page ============ */
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function loadBrickJson(id) {
  const res = await fetch(brickFilePath(id), { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load brick ${id}`);
  return res.json();
}

async function buildMixedBrick(brickIds) {
  const bricks = await Promise.all(brickIds.map(loadBrickJson));
  const sessionId = mixSessionId(brickIds);
  const stored = loadProgress(sessionId);

  const allQuestions = [];
  for (const b of bricks) {
    for (const q of b.questions) {
      allQuestions.push({
        ...q,
        id: `${b.id}-${q.id}`,
        sourceBrickId: b.id,
        sourceBrickTitle: b.title,
      });
    }
  }

  let order;
  if (stored.order && Array.isArray(stored.order) && stored.order.length === allQuestions.length) {
    order = stored.order;
  } else {
    order = shuffleInPlace(allQuestions.map((_, i) => i));
    saveProgress(sessionId, { ...stored, order });
  }

  const byId = new Map(allQuestions.map((q) => [q.id, q]));
  const questions = order
    .map((i) => allQuestions[i])
    .filter(Boolean);

  // Drop any answers for questions that no longer exist (defensive)
  if (stored.answers) {
    for (const k of Object.keys(stored.answers)) {
      if (!byId.has(k)) delete stored.answers[k];
    }
  }

  return {
    id: sessionId,
    title: `Mixed quiz · ${brickIds.length} bricks`,
    brickIds,
    bricks,
    questions,
    isMixed: true,
  };
}

async function renderQuiz() {
  const params = new URLSearchParams(window.location.search);
  const titleEl = document.getElementById("brick-title");
  const counterEl = document.getElementById("question-counter");
  const area = document.getElementById("question-area");
  const paletteEl = document.getElementById("palette");

  const brickId = parseInt(params.get("brick"), 10);
  const bricksParam = params.get("bricks");
  const isMissedMode = params.get("missed") === "1";

  let brick;
  if (isMissedMode) {
    try {
      brick = await buildMissedBrick();
    } catch (e) {
      brick = null;
    }
    if (!brick) {
      area.innerHTML = '<div class="notice">No missed questions yet — get some wrong first! <a href="index.html">Back to bricks</a>.</div>';
      return;
    }
    titleEl.textContent = brick.title;
    document.title = `Renal QBank — Missed (${brick.questions.length})`;
  } else if (bricksParam) {
    const ids = bricksParam
      .split(",")
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) {
      area.innerHTML = '<div class="notice">No bricks selected. <a href="index.html">Back to bricks</a>.</div>';
      return;
    }
    try {
      brick = await buildMixedBrick(ids);
    } catch (e) {
      area.innerHTML = '<div class="notice">Failed to load one or more bricks. <a href="index.html">Back to bricks</a>.</div>';
      return;
    }
    titleEl.textContent = brick.title;
    document.title = `Renal QBank — Mixed (${ids.length})`;
  } else {
    if (!brickId || isNaN(brickId)) {
      area.innerHTML = '<div class="notice">No brick selected. <a href="index.html">Back to bricks</a>.</div>';
      return;
    }
    try {
      brick = await loadBrickJson(brickId);
    } catch (e) {
      area.innerHTML = '<div class="notice">This brick is not available. <a href="index.html">Back to bricks</a>.</div>';
      return;
    }
    titleEl.textContent = `Brick ${brick.id}: ${brick.title}`;
  }

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

  // Exam chrome: flagging is local to this brick, and the bottom navigation
  // reuses the same jump/advance the palette already goes through.
  state.flags = new Set(loadFlags(brick.id));
  const flagBtn = document.getElementById("exam-flag");
  if (flagBtn) {
    flagBtn.addEventListener("click", function () {
      const q = brick.questions[state.progress.current];
      if (!q) return;
      if (state.flags.has(q.id)) state.flags.delete(q.id);
      else state.flags.add(q.id);
      saveFlags(brick.id, Array.from(state.flags));
      updateExamChrome(state);
    });
  }
  const prevBtn = document.getElementById("examfoot-prev");
  if (prevBtn) {
    prevBtn.addEventListener("click", function () {
      if (state.progress.current > 0) jumpTo(state.progress.current - 1);
    });
  }
  const nextBtn = document.getElementById("examfoot-next");
  if (nextBtn) nextBtn.addEventListener("click", advance);

  // The skin lands asynchronously (it waits on the entitlement check), so the
  // labels have to be rewritten once it does — "Item 3 of 40" vs "Question # 3".
  new MutationObserver(function () { updateExamChrome(state); }).observe(
    document.documentElement,
    { attributes: true, attributeFilter: ["data-skin"] }
  );

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
      const label = brick.isMixed ? "this mixed quiz (questions will be reshuffled)" : "this brick";
      if (confirm("Reset progress for " + label + "?")) {
        clearProgress(brick.id);
        if (brick.isMixed) {
          location.reload();
        } else {
          state.progress = { answers: {}, current: 0 };
          state.lastRenderedId = null;
          commit();
          updateCounter(state, counterEl);
          renderPalette(state, paletteEl, jumpTo);
          updateScoreBadge(state, false);
          renderQuestion();
        }
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
      const btn = area.querySelector(`.choice[data-index="${idx}"], .ct-row[data-index="${idx}"]`);
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

  // Optional table-of-choices (e.g. NBME ↑/↓/Unchanged grids).
  // The 5 rows ARE the answer options — no separate choices array needed for selection.
  if (q.choice_table) {
    const ct = q.choice_table;
    const tableWrap = document.createElement("div");
    tableWrap.className = "choice-table-wrap";

    const table = document.createElement("table");
    table.className = "choice-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headerRow.appendChild(document.createElement("th")); // empty corner cell over letters
    ct.headers.forEach((h) => {
      const th = document.createElement("th");
      th.textContent = h;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const rowEls = [];
    ct.rows.forEach((row, idx) => {
      const tr = document.createElement("tr");
      tr.className = "ct-row";
      tr.dataset.index = String(idx);

      const letterTd = document.createElement("td");
      letterTd.className = "ct-letter";
      letterTd.textContent = LETTERS[idx];
      tr.appendChild(letterTd);

      row.forEach((cell) => {
        const td = document.createElement("td");
        td.className = "ct-cell";
        td.appendChild(renderTableCell(cell));
        tr.appendChild(td);
      });

      tr.addEventListener("click", () => {
        if (q.id in state.progress.answers) return;
        const correct = idx === q.answer;
        state.progress.answers[q.id] = { selected: idx, correct };
        saveProgress(state.brick.id, state.progress);
        writeBackToSource(state, q, idx, correct);
        lockTableRows(idx, true);
        updateScoreBadge(state, true);
        renderPalette(state, paletteEl, jumpTo);
      });

      tbody.appendChild(tr);
      rowEls.push(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    area.appendChild(tableWrap);

    function lockTableRows(selectedIdx, animate) {
      rowEls.forEach((tr, idx) => {
        tr.classList.add("locked");
        if (idx === q.answer) tr.classList.add("correct");
        if (idx === selectedIdx && idx !== q.answer) tr.classList.add("incorrect", "selected");
        if (idx === selectedIdx && idx === q.answer) tr.classList.add("selected");
      });
      addTableExplanations(selectedIdx, animate);
    }

    function addTableExplanations(selectedIdx, animate) {
      const existingExp = area.querySelector(".table-explanations");
      if (existingExp) existingExp.remove();
      const existingFb = area.querySelector(".feedback-row");
      if (existingFb) existingFb.remove();

      const block = document.createElement("div");
      block.className = "table-explanations";
      if (!animate) block.style.animation = "none";
      q.explanations.forEach((exp, idx) => {
        const item = document.createElement("div");
        item.className = "table-exp-item";
        if (idx === q.answer) item.classList.add("correct");
        if (idx === selectedIdx && idx !== q.answer) item.classList.add("incorrect");
        const letter = document.createElement("span");
        letter.className = "table-exp-letter";
        letter.textContent = LETTERS[idx];
        const text = document.createElement("span");
        text.className = "table-exp-text";
        text.textContent = exp;
        item.appendChild(letter);
        item.appendChild(text);
        block.appendChild(item);
      });
      area.appendChild(block);

      const row = document.createElement("div");
      row.className = "feedback-row";
      if (!animate) row.style.animation = "none";

      const fbGroup = document.createElement("div");
      fbGroup.style.display = "flex";
      fbGroup.style.alignItems = "center";
      fbGroup.style.gap = "10px";
      fbGroup.style.flexWrap = "wrap";

      const fb = document.createElement("div");
      fb.className = "feedback-text " + (selectedIdx === q.answer ? "correct" : "incorrect");
      fb.textContent = selectedIdx === q.answer ? "Correct" : "Incorrect";
      fbGroup.appendChild(fb);

      if (state.brick.isMixed && q.sourceBrickId) {
        const tag = document.createElement("span");
        tag.className = "source-tag";
        tag.innerHTML = `<span class="source-tag-brick">Brick ${q.sourceBrickId}</span> · ${escapeHtml(q.sourceBrickTitle || "")}`;
        fbGroup.appendChild(tag);
      }
      row.appendChild(fbGroup);

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
      lockTableRows(existing.selected, false);
    }
    return;
  }

  const list = document.createElement("div");
  list.className = "choices";
  // The Examplify skin prints the real range ("Answers: A - E") above the options.
  list.dataset.last = LETTERS[q.choices.length - 1] || "";
  const choiceButtons = [];
  const eyeButtons = [];

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
      writeBackToSource(state, q, idx, correct);
      lockChoices(idx, true);
      updateScoreBadge(state, true);
      renderPalette(state, paletteEl, jumpTo);
    });

    choiceButtons.push(btn);

    // Cross-out: only the exam skins show it (see skins.css). It rules an
    // option out without answering, the way the real software does, so it has
    // to be its own control rather than part of the option button.
    const row = document.createElement("div");
    row.className = "choice-row";
    row.appendChild(btn);

    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "choice-eye";
    const setEyeLabel = () => {
      const on = eye.classList.contains("on");
      eye.setAttribute("aria-pressed", on ? "true" : "false");
      eye.setAttribute(
        "aria-label",
        (on ? "Restore" : "Cross out") + " answer " + LETTERS[idx]
      );
    };
    setEyeLabel();
    eye.addEventListener("click", () => {
      eye.classList.toggle("on");
      btn.classList.toggle("struck");
      setEyeLabel();
    });
    row.appendChild(eye);
    eyeButtons.push(eye);

    list.appendChild(row);
  });

  area.appendChild(list);

  function lockChoices(selectedIdx, animate) {
    const apply = () => {
      // Answering settles the question, so the cross-outs stop applying.
      eyeButtons.forEach((eye) => eye.remove());
      choiceButtons.forEach((btn, idx) => {
        btn.classList.remove("struck");
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

    const fbGroup = document.createElement("div");
    fbGroup.style.display = "flex";
    fbGroup.style.alignItems = "center";
    fbGroup.style.gap = "10px";
    fbGroup.style.flexWrap = "wrap";

    const fb = document.createElement("div");
    fb.className = "feedback-text " + (isCorrect ? "correct" : "incorrect");
    fb.textContent = isCorrect ? "Correct" : "Incorrect";
    fbGroup.appendChild(fb);

    if (state.brick.isMixed && q.sourceBrickId) {
      const tag = document.createElement("span");
      tag.className = "source-tag";
      tag.innerHTML = `<span class="source-tag-brick">Brick ${q.sourceBrickId}</span> · ${escapeHtml(q.sourceBrickTitle || "")}`;
      fbGroup.appendChild(tag);
    }
    row.appendChild(fbGroup);

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

function writeBackToSource(state, q, selectedIdx, correct) {
  if (!state.brick.isMissed) return;
  if (q.sourceBrickId == null || q.sourceQId == null) return;
  const srcProgress = loadProgress(q.sourceBrickId);
  srcProgress.answers = srcProgress.answers || {};
  srcProgress.answers[q.sourceQId] = { selected: selectedIdx, correct };
  saveProgress(q.sourceBrickId, srcProgress);
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
  if (el) {
    el.textContent = `Question ${state.progress.current + 1} of ${state.brick.questions.length}`;
  }
  updateExamChrome(state);
}

/* ---------------------------------------------------------- exam chrome ---
   The item bar and bottom navigation the exam skins re-dress. They are in the
   page at all times and hidden by CSS when no skin is on, so the quiz code has
   one path to keep up to date rather than two. */

const FLAG_KEY = (brickId) => `renal_qbank_flags_${brickId}`;

function loadFlags(brickId) {
  try {
    const raw = localStorage.getItem(FLAG_KEY(brickId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveFlags(brickId, ids) {
  try {
    localStorage.setItem(FLAG_KEY(brickId), JSON.stringify(ids));
  } catch (e) {
    /* private mode — flags just don't persist */
  }
}

function updateExamChrome(state) {
  const skin = document.documentElement.getAttribute("data-skin") || "off";
  const total = state.brick.questions.length;
  const idx = state.progress.current;
  const q = state.brick.questions[idx];

  const itemNo = document.getElementById("exam-itemno");
  if (itemNo) {
    itemNo.textContent =
      skin === "nbme" ? `Item ${idx + 1} of ${total}` : `Question ${idx + 1}`;
  }

  const flagBtn = document.getElementById("exam-flag");
  if (flagBtn && q) {
    const on = state.flags ? state.flags.has(q.id) : false;
    flagBtn.classList.toggle("on", on);
    flagBtn.textContent = on
      ? skin === "nbme" ? "☑ Mark" : "UNFLAG QUESTION"
      : skin === "nbme" ? "☐ Mark" : "FLAG QUESTION";
  }

  const count = document.getElementById("examfoot-count");
  if (count) count.textContent = `${idx + 1} OF ${total} QUESTIONS`;

  const prev = document.getElementById("examfoot-prev");
  if (prev) prev.disabled = idx === 0;

  const next = document.getElementById("examfoot-next");
  if (next) next.textContent = idx < total - 1 ? "Next" : "Finish";
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

function renderTableCell(token) {
  const t = String(token).trim().toLowerCase();
  const span = document.createElement("span");
  if (t === "up" || t === "↑") {
    span.className = "ct-arrow ct-up";
    span.textContent = "↑";
  } else if (t === "up-up" || t === "upup" || t === "↑↑") {
    span.className = "ct-arrow ct-up";
    span.textContent = "↑↑";
  } else if (t === "down" || t === "↓") {
    span.className = "ct-arrow ct-down";
    span.textContent = "↓";
  } else if (t === "down-down" || t === "downdown" || t === "↓↓") {
    span.className = "ct-arrow ct-down";
    span.textContent = "↓↓";
  } else if (t === "unchanged" || t === "no change" || t === "—" || t === "=" || t === "-") {
    span.className = "ct-unchanged";
    span.textContent = "Unchanged";
  } else {
    span.textContent = String(token);
  }
  return span;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
