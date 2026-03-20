import type { CallSummary } from '../api/client';
import type { SavedCall, WizardData } from '../types/wizard';

export function savedToWizard(sc: SavedCall): WizardData {
  return {
    companyName: sc.name,
    toPhoneNumber: sc.toPhoneNumber,
    transferNumber: sc.transferNumber,
    callPurpose: sc.callPurpose,
    customInstructions: sc.customInstructions || '',
    skipInfoRequests: true,
  };
}

export function recentToWizard(call: CallSummary): WizardData {
  return {
    companyName: '',
    toPhoneNumber: call.metadata?.to || '',
    transferNumber: call.metadata?.transferNumber || '',
    callPurpose: call.metadata?.callPurpose || 'speak with a representative',
    customInstructions: '',
    skipInfoRequests: true,
  };
}
