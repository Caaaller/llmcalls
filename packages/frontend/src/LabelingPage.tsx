import React, { useCallback, useEffect, useRef, useState } from 'react';
import './LabelingPage.css';

// Local-dev only — no auth. Uses same API host the rest of the app uses.
const API_URL =
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8068');

type Label = 'h' | 'i' | 'u' | 's';

interface ContextLine {
  speaker: 'user' | 'ai' | 'system';
  text: string;
}

interface Turn {
  callSid: string;
  turnIndex: number;
  timestamp: string;
  contextBefore: ContextLine[];
  text: string;
  metadata: { to?: string; callPurpose?: string };
}

interface Progress {
  total: number;
  labeled: number;
  remaining: number;
}

interface NextTurnResponse {
  turn: Turn | null;
  progress: Progress;
  complete: boolean;
  currentLabel?: Label; // only present in review mode
}

type Mode = 'fresh' | 'review-unclear';

async function fetchNextTurn(mode: Mode): Promise<NextTurnResponse> {
  const url =
    mode === 'review-unclear'
      ? `${API_URL}/api/labeling/next-review?label=u`
      : `${API_URL}/api/labeling/next-turn`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET next-turn failed: ${res.status}`);
  const json = await res.json();
  // GET next-review returns { reviewed, remaining, total } — map to Progress shape
  if (mode === 'review-unclear' && json.progress) {
    const p = json.progress;
    json.progress = {
      total: p.total,
      labeled: p.reviewed ?? 0,
      remaining: p.remaining ?? 0,
    };
  }
  return json;
}

async function postLabel(args: {
  callSid: string;
  turnIndex: number;
  label: Label;
}): Promise<{ success: boolean; already?: boolean }> {
  const res = await fetch(`${API_URL}/api/labeling/label`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`POST label failed: ${res.status}`);
  return res.json();
}

async function postRelabel(args: {
  callSid: string;
  turnIndex: number;
  label: Label;
}): Promise<{ success: boolean }> {
  const res = await fetch(`${API_URL}/api/labeling/relabel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`POST relabel failed: ${res.status}`);
  return res.json();
}

async function postUndo(): Promise<{
  success: boolean;
  removed?: { callSid: string; turnIndex: number; label: Label };
}> {
  const res = await fetch(`${API_URL}/api/labeling/undo`, { method: 'POST' });
  if (res.status === 204) return { success: true };
  if (!res.ok) throw new Error(`POST undo failed: ${res.status}`);
  return res.json();
}

function labelDisplayName(label: Label): string {
  if (label === 'h') return 'Human';
  if (label === 'i') return 'IVR';
  if (label === 'u') return 'Unclear';
  return 'Skip';
}

function LabelingPage(): JSX.Element {
  const [mode, setMode] = useState<Mode>('fresh');
  const [data, setData] = useState<NextTurnResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const submittingRef = useRef<boolean>(false);
  const toastTimerRef = useRef<number | null>(null);
  const dataRef = useRef<NextTurnResponse | null>(null);
  const modeRef = useRef<Mode>(mode);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const loadNext = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchNextTurn(modeRef.current);
      setData(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        const next = await fetchNextTurn(modeRef.current);
        setData(next);
        setError(null);
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2);
        setError(`Failed to load next turn: ${msg} / ${msg2}`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNext();
  }, [loadNext]);

  const showToast = useCallback((msg: string): void => {
    setToast(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 800);
  }, []);

  const undoLast = useCallback(async (): Promise<void> => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const result = await postUndo();
      if (result.removed) {
        showToast(`Undone: ${labelDisplayName(result.removed.label)}`);
      } else {
        showToast('Nothing to undo');
      }
      await loadNext();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to undo: ${msg}`);
    } finally {
      submittingRef.current = false;
    }
  }, [loadNext, showToast]);

  const submitLabel = useCallback(
    async (label: Label): Promise<void> => {
      if (submittingRef.current) return;
      const current = dataRef.current;
      if (!current?.turn) return;
      const turn = current.turn;
      submittingRef.current = true;
      try {
        if (modeRef.current === 'review-unclear') {
          await postRelabel({
            callSid: turn.callSid,
            turnIndex: turn.turnIndex,
            label,
          });
          showToast(`Relabeled → ${labelDisplayName(label)} ✓`);
        } else {
          const result = await postLabel({
            callSid: turn.callSid,
            turnIndex: turn.turnIndex,
            label,
          });
          showToast(
            result.already
              ? `Already labeled — advancing`
              : `Saved: ${labelDisplayName(label)} ✓`
          );
        }
        await loadNext();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to save label: ${msg}`);
      } finally {
        submittingRef.current = false;
      }
    },
    [loadNext, showToast]
  );

  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent): void {
      if (ev.repeat) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const k = ev.key;
      let label: Label | null = null;
      if (k === 'h' || k === 'H' || k === 'ArrowRight') label = 'h';
      else if (k === 'i' || k === 'I' || k === 'ArrowLeft') label = 'i';
      else if (k === 'u' || k === 'U' || k === 'ArrowUp') label = 'u';
      else if (k === 's' || k === 'S' || k === 'ArrowDown') label = 's';
      if (label) {
        ev.preventDefault();
        void submitLabel(label);
        return;
      }
      if (k === 'z' || k === 'Z' || k === 'Backspace') {
        ev.preventDefault();
        void undoLast();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [submitLabel, undoLast]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="labeling-page">
        <div className="labeling-loading">Loading…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="labeling-page">
        <div className="labeling-error">
          {error ?? 'No data.'}
          <button onClick={() => void loadNext()}>Retry</button>
        </div>
      </div>
    );
  }

  const { turn, progress, complete, currentLabel } = data;
  const pct =
    progress.total > 0
      ? Math.round((progress.labeled / progress.total) * 100)
      : 0;

  function switchMode(next: Mode): void {
    if (next === mode) return;
    setMode(next);
    modeRef.current = next;
    void loadNext();
  }

  return (
    <div className="labeling-page">
      <div className="labeling-container">
        <header className="labeling-header">
          <div className="labeling-title">
            {mode === 'review-unclear' ? 'Reviewing UNCLEAR' : 'Labeling'}:{' '}
            <strong>{progress.labeled}</strong> /{' '}
            <strong>{progress.total}</strong>{' '}
            <span className="labeling-remaining">
              ({progress.remaining} remaining)
            </span>
          </div>
          <div className="labeling-mode-toggle">
            <button
              className={mode === 'fresh' ? 'active' : ''}
              onClick={() => switchMode('fresh')}
            >
              Fresh labels
            </button>
            <button
              className={mode === 'review-unclear' ? 'active' : ''}
              onClick={() => switchMode('review-unclear')}
            >
              Review UNCLEAR
            </button>
          </div>
          {currentLabel && (
            <div className="labeling-current-label">
              Your current label:{' '}
              <strong>{labelDisplayName(currentLabel)}</strong>
            </div>
          )}
          <div className="labeling-progress-bar">
            <div
              className="labeling-progress-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
        </header>

        {error && (
          <div className="labeling-error-bar">
            {error} <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {complete || !turn ? (
          <div className="labeling-complete">
            <h2>All done.</h2>
            <p>
              {progress.labeled} labels saved out of {progress.total} turns.
            </p>
          </div>
        ) : (
          <>
            <section className="labeling-section labeling-current">
              <h3 className="labeling-section-title">
                Current turn (label this)
              </h3>
              <div className="labeling-current-text">{turn.text}</div>
            </section>

            <section className="labeling-section">
              <h3 className="labeling-section-title">Context</h3>
              {turn.contextBefore.length === 0 ? (
                <div className="labeling-context-empty">
                  (no prior context — first turn)
                </div>
              ) : (
                <ul className="labeling-context-list">
                  {turn.contextBefore.map((line, idx) => (
                    <li
                      key={idx}
                      className={`labeling-context-line speaker-${line.speaker}`}
                    >
                      <span className="labeling-speaker">
                        {line.speaker.toUpperCase()}
                      </span>
                      <span className="labeling-context-text">{line.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="labeling-meta">
              <div>
                <strong>to:</strong> {turn.metadata.to ?? '?'}
              </div>
              <div>
                <strong>purpose:</strong> {turn.metadata.callPurpose ?? '?'}
              </div>
              <div>
                <strong>callSid:</strong> <code>{turn.callSid}</code>
              </div>
              <div>
                <strong>turnIndex:</strong> {turn.turnIndex}
              </div>
            </section>

            <footer className="labeling-keys">
              <button
                className="labeling-key ivr"
                onClick={() => void submitLabel('i')}
              >
                <kbd>←</kbd> <kbd>I</kbd> IVR
              </button>
              <button
                className="labeling-key unclear"
                onClick={() => void submitLabel('u')}
              >
                <kbd>↑</kbd> <kbd>U</kbd> Unclear
              </button>
              <button
                className="labeling-key skip"
                onClick={() => void submitLabel('s')}
              >
                <kbd>↓</kbd> <kbd>S</kbd> Skip
              </button>
              <button
                className="labeling-key human"
                onClick={() => void submitLabel('h')}
              >
                <kbd>→</kbd> <kbd>H</kbd> Human
              </button>
              <button
                className="labeling-key undo"
                onClick={() => void undoLast()}
              >
                <kbd>Z</kbd> Undo
              </button>
            </footer>
          </>
        )}
      </div>

      {toast && <div className="labeling-toast">{toast}</div>}
    </div>
  );
}

export default LabelingPage;
