# Renal QBank — workflow notes

Static-file quiz app for renal-block clinical-vignette practice. Plain HTML/CSS/JS, no build step, runs from any static server.

## Layout

```
index.html             Brick selection grid + multi-brick mixed-quiz selector
quiz.html              Quiz interface (?brick=N or ?bricks=N1,N2,N3)
app.js                 Quiz logic + progress (localStorage per brick or per mixed combo)
style.css              Dark-mode styling
manifest.json          Brick listing { id, title, available }
data/brick-N.json      25 questions per brick
weekN_sourcebricks/    Source PDFs (gitignored — copyrighted, do not commit)
```

## Brick JSON schema

```json
{
  "id": 22,
  "title": "Hypokalemia",
  "questions": [
    {
      "id": 1,
      "stem": "A 46-year-old woman ...",
      "choices": ["...", "...", "...", "...", "..."],
      "answer": 0,
      "explanations": ["...", "...", "...", "...", "..."]
    }
  ]
}
```

- 25 questions per brick, IDs 1–25 in order.
- `answer` is the 0-indexed correct choice.
- 5 choices, 5 explanations (one per choice, even for distractors).

Optional fields used in a few week-1 bricks: `labs`, `diagram`, `choice_table`. Default to plain `choices` for new work.

## Quality bar (read before writing or editing any questions)

1. **Ground every question in the source brick PDF.** Don't invent USMLE associations the brick doesn't mention. Numeric thresholds, transporter names, drug names, and lab cutoffs must match the brick exactly. (The brick's own "Review Questions" section at the end of each PDF is a useful reference for what the source author thought was testable.)

2. **Choices are short and punchy.** Default ≤6–8 words per choice; up to ~10 only if needed for medical specificity. Target average ~25 chars. The teaching/mechanism goes in `explanations`, not in the choice text. Strip:
   - Mechanistic asides: "via X", "due to Y", "from <mechanism>"
   - Hedging: "primarily", "directly", "in the context of"
   - Self-referential: "in this brick", "according to the brick"

   Good: `"Aldosterone-driven renal K+ loss"` · Bad: `"Volume depletion stimulating aldosterone, which drives renal K+ secretion via ENaC and ROMK in the collecting duct"`

3. **No longest-answer bias.** When students can pick the longest choice and be right >50% of the time, the bank is broken. Aim for the correct answer to be the sole longest in <20% of questions (random baseline ~16%). If a concept is naturally long, tighten the correct one OR keep all five short — don't pad distractors with filler to "balance."

4. **USMLE/NBME-style vignettes.** Most stems open with a patient (age, sex, presentation, relevant labs). Pure recall is OK occasionally, but vignettes are strongly preferred. Distractors must be related concepts a student might confuse — not absurdities.

5. **Per-choice explanations.** One short sentence each. The correct choice's explanation states the WHY (mechanism/rule from the brick). Incorrect choices' explanations explain why they're wrong, ideally referencing the right concept.

## Workflow: adding a new week of bricks

Source PDFs land in `weekN_sourcebricks/<id>.pdf`. For each brick:

1. **Dispatch parallel agents — one per brick** (general-purpose subagent). Each agent reads its PDF and writes the brick JSON. The agent prompt must be self-contained: include the source PDF path, the output JSON path, the schema, the quality bar above, and the brick's likely topic (for the `title` field). Read brick-1.json or any week-2 brick for tone/style reference.

2. **Validate after agents complete:**
   ```bash
   node -e "
   const fs = require('fs');
   const ids = [/* your brick ids */];
   for (const id of ids) {
     const j = JSON.parse(fs.readFileSync('data/brick-' + id + '.json', 'utf8'));
     const ok = j.questions.length === 25 && j.questions.every(q =>
       q.choices.length === 5 && q.explanations.length === 5 && typeof q.answer === 'number');
     console.log('brick-' + id + ': ' + (ok ? 'OK' : 'FAIL'));
   }
   "
   ```

3. **Measure length bias** (sole-longest correct should be <20%):
   ```bash
   node -e "
   const fs = require('fs');
   for (const id of [/* ids */]) {
     const j = JSON.parse(fs.readFileSync('data/brick-' + id + '.json', 'utf8'));
     let sole = 0;
     for (const q of j.questions) {
       const lens = q.choices.map(c => c.length);
       const max = Math.max(...lens);
       if (lens[q.answer] === max && lens.filter(l => l === max).length === 1) sole++;
     }
     console.log('brick-' + id + ': sole-longest ' + sole + '/25');
   }
   "
   ```
   If a brick is over the threshold, dispatch a polish-pass agent that *only* edits choice strings (NOT stems, answers, or explanations).

4. **Update `manifest.json`** with the new brick IDs and titles (titles come from the first page of each PDF). Append to the `bricks` array, sorted by id.

5. **Update `app.js` constants** if introducing a new week:
   ```js
   const WEEK_3_BRICKS = [40, 41, ..., 55];
   ```
   And add a corresponding bulk-select button in `index.html` and wire it in `renderHome()` via the existing `wireBulk()` pattern.

6. **Commit and push** when the user asks. Don't add PDFs (they're gitignored).

## Things to avoid

- Don't run `find`, `grep`, `cat`, etc. — use Glob, Grep, Read.
- Don't try to read source PDF transcripts via `cat` — use the Read tool, which handles PDFs natively.
- Don't read agent output transcript files via Bash; the runtime warns about context overflow.
- Don't redistribute the source PDFs — they're copyrighted study material.
- Don't modify week-1 questions unless explicitly asked. The user reworked weeks 2 and 3 only because they didn't like the older agent output.
