import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';

interface InfoRequestNotificationProps {
  callSid: string;
}

function InfoRequestNotification({ callSid }: InfoRequestNotificationProps) {
  const [requestedInfo, setRequestedInfo] = useState<string | null>(null);
  const [response, setResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function poll() {
      api.calls
        .getPendingInfo(callSid)
        .then(data => {
          if (data.pending && data.requestedInfo) {
            setRequestedInfo(data.requestedInfo);
          } else {
            setRequestedInfo(null);
            if (submitted) setSubmitted(false);
          }
        })
        .catch(() => {});
    }

    poll();
    intervalRef.current = setInterval(poll, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [callSid, submitted]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!response.trim()) return;

    setSubmitting(true);
    try {
      await api.calls.provideInfo(callSid, response.trim());
      setSubmitted(true);
      setRequestedInfo(null);
      setResponse('');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div style={styles.container}>
        <div style={styles.successBanner}>Info sent — call resuming.</div>
      </div>
    );
  }

  if (!requestedInfo) return null;

  return (
    <div style={styles.container}>
      <div style={styles.banner}>
        <div style={styles.label}>The call needs info from you:</div>
        <div style={styles.info}>{requestedInfo}</div>
        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            type="text"
            value={response}
            onChange={e => setResponse(e.target.value)}
            placeholder={`Enter your ${requestedInfo}`}
            style={styles.input}
            autoFocus
          />
          <button
            type="submit"
            disabled={submitting || !response.trim()}
            style={styles.button}
          >
            {submitting ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    margin: '12px 0',
  },
  banner: {
    background: '#FFF3CD',
    border: '1px solid #FFECB5',
    borderRadius: 8,
    padding: '12px 16px',
  },
  successBanner: {
    background: '#D1E7DD',
    border: '1px solid #BADBCC',
    borderRadius: 8,
    padding: '12px 16px',
    color: '#0F5132',
  },
  label: {
    fontWeight: 600,
    marginBottom: 4,
    color: '#664D03',
  },
  info: {
    fontSize: '1.1em',
    marginBottom: 8,
    color: '#664D03',
  },
  form: {
    display: 'flex',
    gap: 8,
  },
  input: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: 4,
    border: '1px solid #CCC',
    fontSize: '1em',
  },
  button: {
    padding: '8px 16px',
    borderRadius: 4,
    border: 'none',
    background: '#0D6EFD',
    color: '#FFF',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: '1em',
  },
};

export default InfoRequestNotification;
