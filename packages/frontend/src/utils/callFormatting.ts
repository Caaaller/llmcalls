export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return 'N/A';
  return new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatTimeOfDay(
  date: Date | string | null | undefined
): string {
  if (!date) return 'N/A';
  return new Date(date).toLocaleTimeString();
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (!ms) return 'N/A';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}
