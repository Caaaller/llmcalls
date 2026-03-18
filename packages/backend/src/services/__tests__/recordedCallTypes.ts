import { CallAction } from '../ivrNavigatorService';

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
