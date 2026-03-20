export interface WizardData {
  companyName: string;
  toPhoneNumber: string;
  callPurpose: string;
  customInstructions: string;
  transferNumber: string;
  skipInfoRequests: boolean;
}

export interface SavedCall {
  _id: string;
  name: string;
  toPhoneNumber: string;
  transferNumber: string;
  callPurpose: string;
  customInstructions: string;
  createdAt: string;
  updatedAt: string;
}

export type WizardStep = 1 | 2 | 3 | 4;

export const EMPTY_WIZARD: WizardData = {
  companyName: '',
  toPhoneNumber: '',
  callPurpose: 'speak with a representative',
  customInstructions: '',
  transferNumber: '',
  skipInfoRequests: true,
};
