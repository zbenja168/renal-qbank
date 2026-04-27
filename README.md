# Renal QBank

Clinical-vignette practice questions covering Week 1 of the renal block — 21 bricks, 25 questions each (525 total).

## Format

- USMLE / NBME / UWorld-style single-best-answer vignettes
- Tutor mode: instant feedback with per-choice explanations
- Live score tracking, palette navigation, progress saved per brick (localStorage)
- Dark mode, keyboard shortcuts (1–5 to answer, Enter / → for next, ← for previous)

## Run locally

Any static-file server works. Examples:

```bash
# Node
npx serve .

# Python
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Layout

```
index.html       Brick selection grid
quiz.html        Quiz interface (?brick=N)
style.css        Dark-mode styling
app.js           Quiz logic + progress tracking
manifest.json    Brick listing
data/brick-N.json  25 questions per brick
```

## Disclaimer

Educational use only. Questions are derivative study material based on personal review of source content.
