import React from 'react';
import type { UseCallRecordingResult } from '../hooks/useCallRecording';

interface CallRecordingPlayerProps {
  recording: UseCallRecordingResult;
  callSid: string;
  hasRecordingUrl: boolean;
  autoPlay?: boolean;
}

export function CallRecordingPlayer({
  recording,
  callSid,
  hasRecordingUrl,
  autoPlay,
}: CallRecordingPlayerProps) {
  const {
    recordingUrl,
    recordingLoading,
    recordingError,
    audioRef,
    handleLoadRecording,
    onTimeUpdate,
  } = recording;

  if (!hasRecordingUrl) return null;

  if (!recordingUrl) {
    return (
      <>
        <button
          type="button"
          className="btn-play-recording"
          disabled={recordingLoading}
          onClick={() => handleLoadRecording(callSid)}
        >
          {recordingLoading ? 'Loading...' : 'Load Recording'}
        </button>
        {recordingError && (
          <span className="recording-error">{recordingError}</span>
        )}
      </>
    );
  }

  return (
    <div className="audio-player-sticky">
      <audio
        ref={audioRef}
        src={recordingUrl}
        controls
        autoPlay={autoPlay}
        onTimeUpdate={onTimeUpdate}
      />
      <a
        href={recordingUrl}
        download="call-recording.mp3"
        className="btn-download-recording"
      >
        Download
      </a>
    </div>
  );
}
