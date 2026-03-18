/**
 * Live Call Test Cases
 * Pre-defined test scenarios for automated evaluation
 */

export interface LiveCallTestCase {
  id: string;
  name: string;
  description: string;
  phoneNumber: string;
  callPurpose: string;
  customInstructions?: string;
  expectedOutcome: {
    shouldReachHuman?: boolean;
    maxDTMFPresses?: number;
    expectedDigits?: string[];
    maxDurationSeconds?: number;
    minDurationSeconds?: number;
  };
}

export const DEFAULT_TEST_CASES: LiveCallTestCase[] = [
  {
    id: 'amazon-cs',
    name: 'Amazon Customer Service',
    description: 'Call Amazon customer service and navigate to representative',
    phoneNumber: '+18882804331',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 180,
    },
  },
  {
    id: 'walmart-cs',
    name: 'Walmart Customer Service',
    description: 'Call Walmart customer service and navigate to representative',
    phoneNumber: '+18009256278',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 180,
    },
  },
  {
    id: 'target-cs',
    name: 'Target Guest Services',
    description: 'Call Target guest services and navigate to representative',
    phoneNumber: '+18004400680',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 180,
    },
  },
  {
    id: 'bestbuy-cs',
    name: 'Best Buy Customer Service',
    description:
      'Call Best Buy customer service and navigate to representative',
    phoneNumber: '+18882378289',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 180,
    },
  },
  // BofA requires real account credentials — no bypass to representative
  // {
  //   id: 'bankofamerica-cs',
  //   name: 'Bank of America Customer Service',
  //   description: 'Call Bank of America and navigate to representative',
  //   phoneNumber: '+18004321000',
  //   callPurpose: 'speak with a representative',
  //   customInstructions: 'If asked for account number or telephone access ID, provide 4853901276.',
  //   expectedOutcome: {
  //     shouldReachHuman: true,
  //     maxDurationSeconds: 180,
  //   },
  // },
  {
    id: 'wellsfargo-cs',
    name: 'Wells Fargo Customer Service',
    description: 'Call Wells Fargo and navigate to representative',
    phoneNumber: '+18008693557',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
    },
  },
  {
    id: 'att-cs',
    name: 'AT&T Customer Service',
    description: 'Call AT&T customer service and navigate to representative',
    phoneNumber: '+18003310500',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 180,
    },
  },
  {
    id: 'verizon-cs',
    name: 'Verizon Customer Service',
    description: 'Call Verizon customer service and navigate to representative',
    phoneNumber: '+18009220204',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDTMFPresses: 5,
      maxDurationSeconds: 180,
    },
  },
];

export const QUICK_TEST_CASES: LiveCallTestCase[] = [
  {
    id: 'quick-amazon',
    name: 'Quick Test - Amazon',
    description: 'Quick test with Amazon customer service',
    phoneNumber: '+18882804331',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      maxDurationSeconds: 180,
    },
  },
];

export const TEST_IVR_CASES: LiveCallTestCase[] = [
  {
    id: 'test-ivr-operator',
    name: 'Banking IVR - Operator (Press 0)',
    description: 'Root menu - press 0 for operator',
    phoneNumber: '+17208150797',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      expectedDigits: ['0'],
      shouldReachHuman: true,
      maxDurationSeconds: 120,
    },
  },
  {
    id: 'test-ivr-activate-card',
    name: 'Banking IVR - Activate Card (1 → 1)',
    description: 'Card services → activate a card',
    phoneNumber: '+17208150797',
    callPurpose: 'activate my new debit card',
    expectedOutcome: {
      expectedDigits: ['1', '1'],
      shouldReachHuman: true,
      maxDurationSeconds: 120,
    },
  },
  {
    id: 'test-ivr-credit-billing',
    name: 'Banking IVR - Credit Card Billing (1 → 2 → 1)',
    description: 'Card services → billing → credit card',
    phoneNumber: '+17208150797',
    callPurpose: 'credit card billing',
    expectedOutcome: {
      expectedDigits: ['1', '2', '1'],
      shouldReachHuman: true,
      maxDurationSeconds: 120,
    },
  },
  {
    id: 'test-ivr-debit-billing',
    name: 'Banking IVR - Debit Card Billing (1 → 2 → 2)',
    description: 'Card services → billing → debit card',
    phoneNumber: '+17208150797',
    callPurpose: 'debit card billing',
    expectedOutcome: {
      expectedDigits: ['1', '2', '2'],
      shouldReachHuman: true,
      maxDurationSeconds: 120,
    },
  },
  {
    id: 'test-ivr-pending-dues',
    name: 'Banking IVR - Pending Dues (1 → 2 → 3)',
    description: 'Card services → billing → pending dues',
    phoneNumber: '+17208150797',
    callPurpose: 'pending dues on my account',
    expectedOutcome: {
      expectedDigits: ['1', '2', '3'],
      shouldReachHuman: true,
      maxDurationSeconds: 120,
    },
  },
  {
    id: 'test-ivr-stolen-card',
    name: 'Banking IVR - Stolen Card (1 → 3)',
    description: 'Card services → report stolen card',
    phoneNumber: '+17208150797',
    callPurpose: 'my card was stolen',
    expectedOutcome: {
      expectedDigits: ['1', '3'],
      shouldReachHuman: true,
      maxDurationSeconds: 120,
    },
  },
  {
    id: 'test-ivr-new-loan',
    name: 'Banking IVR - New Loan (2 → 1)',
    description: 'Loans → apply for new loan',
    phoneNumber: '+17208150797',
    callPurpose: 'apply for a home loan',
    expectedOutcome: {
      expectedDigits: ['2', '1'],
      shouldReachHuman: true,
      maxDurationSeconds: 120,
    },
  },
  {
    id: 'test-ivr-existing-loan',
    name: 'Banking IVR - Existing Loan (2 → 2)',
    description: 'Loans → existing loan status',
    phoneNumber: '+17208150797',
    callPurpose: 'check my existing loan status',
    expectedOutcome: {
      expectedDigits: ['2', '2'],
      shouldReachHuman: true,
      maxDurationSeconds: 120,
    },
  },
  {
    id: 'test-ivr-balance',
    name: 'Banking IVR - Check Balance (3 → 1)',
    description: 'Account services → check balance',
    phoneNumber: '+17208150797',
    callPurpose: 'check my account balance',
    expectedOutcome: {
      expectedDigits: ['3', '1'],
      shouldReachHuman: true,
      maxDurationSeconds: 120,
    },
  },
  {
    id: 'test-ivr-open-account',
    name: 'Banking IVR - Open Account (3 → 2)',
    description: 'Account services → open new account',
    phoneNumber: '+17208150797',
    callPurpose: 'open a new savings account',
    expectedOutcome: {
      expectedDigits: ['3', '2'],
      shouldReachHuman: true,
      maxDurationSeconds: 120,
    },
  },
  {
    id: 'test-ivr-close-account',
    name: 'Banking IVR - Close Account (3 → 3)',
    description: 'Account services → close account',
    phoneNumber: '+17208150797',
    callPurpose: 'close my account',
    expectedOutcome: {
      expectedDigits: ['3', '3'],
      shouldReachHuman: true,
      maxDurationSeconds: 120,
    },
  },
  {
    id: 'test-ivr-statements',
    name: 'Banking IVR - Statements (3 → 4)',
    description: 'Account services → request statements',
    phoneNumber: '+17208150797',
    callPurpose: 'request bank statements',
    expectedOutcome: {
      expectedDigits: ['3', '4'],
      shouldReachHuman: true,
      maxDurationSeconds: 120,
    },
  },
  {
    id: 'test-ivr-fraud',
    name: 'Banking IVR - Fraud (4 → immediate transfer)',
    description: 'Report fraud → immediate transfer to fraud dept',
    phoneNumber: '+17208150797',
    callPurpose: 'report fraudulent activity on my card',
    expectedOutcome: {
      expectedDigits: ['4'],
      shouldReachHuman: true,
      maxDurationSeconds: 120,
    },
  },
];
