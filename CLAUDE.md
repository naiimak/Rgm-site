# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

<!-- Guidelines above: github.com/forrestchang/andrej-karpathy-skills (MIT), vendored
     verbatim so they can be diffed against upstream. Project notes below. -->

# Football Edge

Streamlit app that prices top-five-league football fixtures against bookmaker
odds. `footy/` is the model, `app.py` is the dashboard.

## Running it

`./run.sh` — builds `.venv` on first run, then starts Streamlit on :8501.
Needs Python 3.10+. Arguments pass through (`./run.sh --server.port 8600`).

## Things that will cost you time if you don't know them

- **Data comes from football-data.co.uk and is cached in `cache/`** (gitignored).
  A cold cache means a minute or two of downloads on first launch.
- **The CSVs mix latin-1 and UTF-8-with-BOM, and switch without warning.** Read
  them through `data._read_csv`, never `pd.read_csv` directly. Forcing an
  encoding turns the first header into `ï»¿Div`, which silently drops whole
  seasons from every `df[df["Div"] == div]` filter with no error raised.
- **The season window is derived from the calendar**, via
  `data.current_season_start()`. Don't hard-code years; they go stale each August.
- **Not every league publishes the current season's file.** A missing season is
  skipped with a note rather than failing the load — that is expected.
- **Backtests are slow.** A walk-forward run refits every N days and takes well
  over ten minutes for an 18-month window. Run it in the background, not in a
  foreground command that will time out.

## Verifying a change

Tests don't exist yet. To confirm something works, run the app and drive it:
Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` and needs
`--no-sandbox`. Check for `[data-testid="stException"]` on each tab — Streamlit
swallows exceptions into the page rather than the exit code, so a clean exit
does not mean a working app.

## Judging model output

Check calibration before profit. The backtest tab buckets bets by predicted
probability against actual hit rate; the model currently runs overconfident, so
a positive claimed edge is not evidence of a real one.
