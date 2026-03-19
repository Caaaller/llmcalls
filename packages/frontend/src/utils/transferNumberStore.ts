const STORAGE_KEY = 'callbot_transfer_numbers';
const MAX_NUMBERS = 5;

export function getSavedTransferNumbers(): Array<string> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveTransferNumber(number: string): void {
  const trimmed = number.trim();
  if (!trimmed) return;
  const existing = getSavedTransferNumbers();
  const filtered = existing.filter(n => n !== trimmed);
  const updated = [trimmed, ...filtered].slice(0, MAX_NUMBERS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}
