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
}

async function fetchNextTurn(): Promise<NextTurnResponse> {
  const res = await fetch(`${API_URL}/api/labeling/next-turn`);
  if (!res.ok) throw new Error(`GET next-turn failed: ${res.status}`);
  return res.json();
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

function labelDisplayName(label: Label): string {
  if (label === 'h') return 'Human';
  if (label === 'i') return 'IVR';
  if (label === 'u') return 'Unclear';
  return 'Skip';
}

function LabelingPage(): JSX.Element {
  const [data, setData] = useState<NextTurnResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const submittingRef = useRef<boolean>(false);
  const toastTimerRef = useRef<number | null>(null);
  // Latest data read by the stable submitLabel — avoids recreating the
  // keydown listener every time `data` changes (which drops keypresses
  // during the remount window and is the cause of the "stuck at 1" bug).
  const dataRef = useRef<NextTurnResponse | null>(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const loadNext = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchNextTurn();
      setData(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        const next = await fetchNextTurn();
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

  const submitLabel = useCallback(
    async (label: Label): Promise<void> => {
      if (submittingRef.current) return;
      const current = dataRef.current;
      if (!current?.turn) return;
      const turn = current.turn;
      submittingRef.current = true;
      try {
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
        await loadNext();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          await postLabel({
            callSid: turn.callSid,
            turnIndex: turn.turnIndex,
            label,
          });
          showToast(`Saved: ${labelDisplayName(label)} ✓`);
          await loadNext();
        } catch (err2) {
          const msg2 = err2 instanceof Error ? err2.message : String(err2);
          setError(`Failed to save label: ${msg} / ${msg2}`);
        }
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
      const k = ev.key.toLowerCase();
      if (k === 'h' || k === 'i' || k === 'u' || k === 's') {
        ev.preventDefault();
        void submitLabel(k as Label);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [submitLabel]);

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

  const { turn, progress, complete } = data;
  const pct =
    progress.total > 0
      ? Math.round((progress.labeled / progress.total) * 100)
      : 0;

  return (
    <div className="labeling-page">
      <div className="labeling-container">
        <header className="labeling-header">
          <div className="labeling-title">
            Labeling: <strong>{progress.labeled}</strong> /{' '}
            <strong>{progress.total}</strong>{' '}
            <span className="labeling-remaining">
              ({progress.remaining} remaining)
            </span>
          </div>
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

            <section className="labeling-section labeling-current">
              <h3 className="labeling-section-title">
                Current turn (label this)
              </h3>
              <div className="labeling-current-text">{turn.text}</div>
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
                className="labeling-key human"
                onClick={() => void submitLabel('h')}
              >
                <kbd>H</kbd> Human
              </button>
              <button
                className="labeling-key ivr"
                onClick={() => void submitLabel('i')}
              >
                <kbd>I</kbd> IVR
              </button>
              <button
                className="labeling-key unclear"
                onClick={() => void submitLabel('u')}
              >
                <kbd>U</kbd> Unclear
              </button>
              <button
                className="labeling-key skip"
                onClick={() => void submitLabel('s')}
              >
                <kbd>S</kbd> Skip
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
