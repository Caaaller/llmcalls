/**
 * Prompt Configuration
 * Formats conversation/action history for the unified AI call
 */

export interface ActionHistoryEntry {
  turnNumber: number;
  ivrSpeech: string;
  action: string;
  digit?: string;
  speech?: string;
  reason?: string;
}

/**
 * Format action history into a concise context block for the AI
 */
const TOKEN_LIMIT = 100_000;
const CHARS_PER_TOKEN = 4;

function formatEntry(entry: ActionHistoryEntry): string {
  let actionDesc = `Turn ${entry.turnNumber}: IVR said: "${entry.ivrSpeech}"`;
  switch (entry.action) {
    case 'press_digit':
      actionDesc += ` → Pressed ${entry.digit}`;
      break;
    case 'speak':
      actionDesc += ` → Said: "${entry.speech}"`;
      break;
    case 'wait':
      actionDesc += ` → Stayed silent`;
      break;
    case 'hang_up':
      actionDesc += ` → Hung up (${entry.reason})`;
      break;
    case 'human_detected':
      actionDesc += ` → Human detected, transferring`;
      break;
    default:
      actionDesc += ` → ${entry.action}`;
  }
  return actionDesc;
}

export function formatConversationForAI(
  actionHistory: Array<ActionHistoryEntry>
): string {
  if (actionHistory.length === 0) {
    return 'CONVERSATION SO FAR:\nThis is the first turn of the call.';
  }

  const lines = actionHistory.map(formatEntry);
  const full = lines.join('\n');

  if (full.length / CHARS_PER_TOKEN <= TOKEN_LIMIT) {
    return `CONVERSATION SO FAR:\n${full}`;
  }

  // Over token limit — keep first 2 turns for context + recent turns that fit
  const firstTurns = lines.slice(0, 2);
  const remaining = lines.slice(2);
  const budget =
    TOKEN_LIMIT * CHARS_PER_TOKEN - firstTurns.join('\n').length - 50;
  const recent: Array<string> = [];
  let used = 0;
  for (let i = remaining.length - 1; i >= 0; i--) {
    if (used + remaining[i].length > budget) break;
    recent.unshift(remaining[i]);
    used += remaining[i].length;
  }
  const skipped = remaining.length - recent.length;
  return `CONVERSATION SO FAR:\n${firstTurns.join('\n')}\n[... ${skipped} turns omitted ...]\n${recent.join('\n')}`;
}

export default { formatConversationForAI };
