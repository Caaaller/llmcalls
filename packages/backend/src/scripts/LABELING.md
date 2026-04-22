# Human-vs-IVR Labeling Harness

## Why this exists

Our human-vs-IVR classifier has been misclassifying live agents (e.g. "Diana"
at NYU Langone) as IVR prompts. Before we can compare classifier variants
(tuned LLM router, BERT, heuristics) we need a ground-truth dataset to measure
against — otherwise we're just swapping one unmeasured black box for another.
This harness extracts real user-facing turns from recent calls and gives the
operator a fast CLI to label each one. The resulting JSONL file is the eval
set the next step will score against.

## How to run

```bash
# 1. Extract the last 100 calls' user turns into turns-unlabeled.jsonl
pnpm --filter backend ts-node src/scripts/extractLabelingDataset.ts

# 2. Label them (interactive TTY; resumes automatically if interrupted)
pnpm --filter backend ts-node src/scripts/labelTurns.ts

# 3. Inspect output
wc -l ../../data/labeling/turns-labeled.jsonl
```

Both files live under `<repo>/data/labeling/` (gitignored — may contain PII).

## Data format

`turns-unlabeled.jsonl` — one row per user-speaker turn:

```json
{
  "callSid": "v3:...",
  "turnIndex": 3,
  "timestamp": "2026-04-22T17:10:41Z",
  "contextBefore": [
    { "speaker": "ai", "text": "..." },
    { "speaker": "user", "text": "..." }
  ],
  "text": "Good afternoon, NYU Langone Health.",
  "metadata": { "to": "+1...", "callPurpose": "..." }
}
```

`turns-labeled.jsonl` — one row per keypress, appended live so you never lose work:

```json
{ "callSid": "v3:...", "turnIndex": 3, "label": "h", "labeledAt": "2026-..." }
```

Labels: `h` = human, `i` = IVR, `u` = unclear. Rows are matched back to turns by
`(callSid, turnIndex)`. Re-running the labeler skips anything already present
in `turns-labeled.jsonl`.

## Interpreting the data

- Every row in `turns-unlabeled.jsonl` is a phrase the IVR/agent said to the
  caller, captured from `CallHistory.conversation` where `type === 'user'`
  (confusingly named — in our schema `user` means the remote phone system).
- `contextBefore` holds up to 4 prior turns so the labeler can see what the AI
  had just asked. If the AI said "please hold" and the next `user` turn is
  "Diana, how can I help?" that's almost certainly a human pickup, not IVR.
- Duplicate turn texts across different `callSid`s are fine — keep them; model
  eval wants the real distribution, not deduped prompts.

## What comes next (not built yet)

Once `turns-labeled.jsonl` has enough rows (target: a few hundred, balanced),
the follow-up work is a separate harness that runs each candidate classifier
(current router, tuned prompt, BERT, etc.) against the labeled turns and
reports precision/recall per class. That lives in a future PR — this one is
only the data-collection tool.

## Future enhancements

- Audio features (pitch/cadence) aren't in Mongo, so they're skipped. If we
  ever want them, the recordings are downloadable via `downloadRecordings.ts`
  and can be joined on `callSid`.
- The CLI is intentionally dumb (no undo, no edit). If a label is wrong, edit
  `turns-labeled.jsonl` by hand — one row per line.
