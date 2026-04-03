import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../api/client';

export function getSeekSeconds(
  eventTimestamp: Date | string | undefined,
  callStartTime: Date | string | undefined
): number {
  if (!eventTimestamp || !callStartTime) return 0;
  return Math.max(
    0,
    (new Date(eventTimestamp).getTime() - new Date(callStartTime).getTime()) /
      1000
  );
}

export interface UseCallRecordingResult {
  recordingUrl: string | null;
  recordingLoading: boolean;
  recordingError: string | null;
  audioRef: React.RefObject<HTMLAudioElement>;
  audioCurrentTime: number;
  handleLoadRecording: (callSid: string) => Promise<void>;
  handleSeekToEvent: (
    eventTimestamp: Date | string | undefined,
    callStartTime: Date | string | undefined
  ) => void;
  onTimeUpdate: () => void;
}

export function useCallRecording(
  selectedCallSid: string | null
): UseCallRecordingResult {
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingLoading, setRecordingLoading] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [audioCurrentTime, setAudioCurrentTime] = useState<number>(0);
  const audioRef = useRef<HTMLAudioElement>(null!);
  const prevCallSidRef = useRef<string | null>(null);

  const handleLoadRecording = useCallback(async (callSid: string) => {
    setRecordingError(null);
    setRecordingLoading(true);
    try {
      const blobUrl = await api.calls.getRecordingUrl(callSid);
      setRecordingUrl(blobUrl);
    } catch {
      setRecordingError('Failed to load recording');
    } finally {
      setRecordingLoading(false);
    }
  }, []);

  const handleSeekToEvent = useCallback(
    (
      eventTimestamp: Date | string | undefined,
      callStartTime: Date | string | undefined
    ) => {
      const audio = audioRef.current;
      if (!audio || !audio.src) return;
      const seconds = getSeekSeconds(eventTimestamp, callStartTime);
      audio.currentTime = seconds;
      if (audio.paused) {
        audio.play();
      }
    },
    []
  );

  const onTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setAudioCurrentTime(audioRef.current.currentTime);
    }
  }, []);

  // Clean up blob URL when call changes
  useEffect(() => {
    if (prevCallSidRef.current !== selectedCallSid) {
      if (recordingUrl) {
        URL.revokeObjectURL(recordingUrl);
        setRecordingUrl(null);
      }
      setAudioCurrentTime(0);
      setRecordingError(null);
      prevCallSidRef.current = selectedCallSid;
    }
  }, [selectedCallSid, recordingUrl]);

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (recordingUrl) {
        URL.revokeObjectURL(recordingUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    recordingUrl,
    recordingLoading,
    recordingError,
    audioRef,
    audioCurrentTime,
    handleLoadRecording,
    handleSeekToEvent,
    onTimeUpdate,
  };
}
