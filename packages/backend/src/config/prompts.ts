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
export function formatConversationForAI(
  actionHistory: Array<ActionHistoryEntry>
): string {
  if (actionHistory.length === 0) {
    return 'CONVERSATION SO FAR:\nThis is the first turn of the call.';
  }

  const lines = actionHistory.map(entry => {
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
  });

  return `CONVERSATION SO FAR:\n${lines.join('\n')}`;
}

export default { formatConversationForAI };
