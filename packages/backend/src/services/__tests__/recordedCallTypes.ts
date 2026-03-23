import { CallAction } from '../ivrNavigatorService';

// ── v1 Linear Format ──

export interface RecordedTurn {
  turnNumber: number;
  ivrSpeech: string;
  aiAction: CallAction;
}

export interface RecordedCall {
  id: string;
  testCaseId: string;
  recordedAt: string;
  config: { callPurpose: string; customInstructions?: string };
  turns: Array<RecordedTurn>;
  outcome: {
    finalStatus: string;
    durationSeconds: number;
    reachedHuman: boolean;
    dtmfDigits: Array<string>;
  };
}

// ── v2 Tree Format ──

export interface TreeNode {
  id: string;
  ivrSpeech: string;
  children: Array<TreeEdge>;
}

export interface TreeEdge {
  aiAction: CallAction;
  recordedAt: string;
  isLatestPath: boolean;
  child: TreeNode | TerminalOutcome;
}

export interface TerminalOutcome {
  terminal: true;
  finalStatus: string;
  durationSeconds: number;
  reachedHuman: boolean;
  dtmfDigits: Array<string>;
}

export interface RecordedCallTree {
  version: 2;
  id: string;
  testCaseId: string;
  lastRecordedAt: string;
  config: { callPurpose: string; customInstructions?: string };
  root: TreeNode;
}

export function isTerminalOutcome(
  node: TreeNode | TerminalOutcome
): node is TerminalOutcome {
  return 'terminal' in node && node.terminal === true;
}
