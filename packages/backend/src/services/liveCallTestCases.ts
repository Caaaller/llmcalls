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
  skipInfoRequests?: boolean;
  expectedOutcome: {
    shouldReachHuman?: boolean;
    requireConfirmedTransfer?: boolean;
    maxDTMFPresses?: number;
    expectedDigits?: string[];
    maxDurationSeconds?: number;
    minDurationSeconds?: number;
    /** Set to false to skip the "no application error" check (defaults to failing on errors). */
    failOnApplicationError?: boolean;
  };
}

export const DEFAULT_TEST_CASES: LiveCallTestCase[] = [
  {
    id: 'walmart-cs',
    name: 'Walmart CS — bypass AI assistant to reach a human',
    description:
      'Walmart uses a conversational AI assistant. AI must redirect past it to reach a human.',
    phoneNumber: '+18009256278',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 300,
    },
  },
  {
    id: 'target-cs',
    name: 'Target CS — navigate DTMF menu to reach a human',
    description:
      'Target uses a standard DTMF menu. AI must select the correct option to reach a human.',
    phoneNumber: '+18004400680',
    callPurpose: 'question about a recent in-store purchase',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 300,
    },
  },
  {
    id: 'bestbuy-cs',
    name: 'Best Buy CS — multi-step IVR to reach a human',
    description:
      'Best Buy has a virtual assistant followed by DTMF menus and account lookup. AI must navigate all steps to reach a human.',
    phoneNumber: '+18882378289',
    callPurpose: 'question about a recent order',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 300,
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
    name: 'Wells Fargo CS — navigate hold menu to reach a human',
    description:
      'Wells Fargo has multiple DTMF menus and hold queues. AI must navigate correctly without getting routed to new account opening.',
    phoneNumber: '+18008693557',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 300,
    },
  },
  {
    id: 'att-cs',
    name: 'AT&T CS — phone number lookup then reach a human',
    description:
      'AT&T asks for account phone number to look up the account before routing. AI must speak the user phone number and then reach a human.',
    phoneNumber: '+18003310500',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 300,
    },
  },
  {
    id: 'verizon-cs',
    name: 'Verizon CS — personal vs business routing to reach a human',
    description:
      'Verizon repeatedly asks business/personal and service type. AI must press 2 for personal and reach a live agent.',
    phoneNumber: '+18009220204',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDTMFPresses: 5,
      maxDurationSeconds: 300,
    },
  },
  {
    id: 'loop-test-720',
    name: 'Costco Warehouse — looping menu, press 1 for Admin Staff',
    description:
      'Costco IVR loops its menu indefinitely. AI must recognize the menu mid-loop, press 1 for Administrative Staff, and wait for transfer.',
    phoneNumber: '+17205871000',
    callPurpose: 'speak with a representative',
    customInstructions:
      'This is a Costco warehouse. Navigate the IVR menu to reach a human (administrative staff is the best option). Use DTMF when prompted.',
    expectedOutcome: {
      shouldReachHuman: true,
      expectedDigits: ['1'],
      maxDurationSeconds: 300,
    },
  },
  {
    id: 'usps-failed-pickup',
    name: 'USPS — report failed package pickup marked as completed',
    description:
      'USPS IVR. AI must navigate menus to reach a human to report that a scheduled pickup was marked completed but never happened. Callback number is different from the intended end user, so hallucinated DTMF presses are especially damaging.',
    phoneNumber: '+18002758777',
    callPurpose:
      "Failed package pickup. Pickup request EMC717292788 was marked as completed even though it didn't actually happen",
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 420,
    },
  },
  {
    id: 'umr-coverage',
    name: 'UMR Insurance — conversational AI with short listen window',
    description:
      'UMR uses a conversational AI that asks yes/no questions then "How can I help you?". AI must give ultra-short keyword answers — the system has a very short listen window and rejects long responses.',
    phoneNumber: '+18002073172',
    callPurpose: 'Coverage question',
    customInstructions:
      'Member ID is 35142679. Date of birth is March 6th 1998. Provide these when asked.',
    skipInfoRequests: true,
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 600,
    },
  },
];

export const LONG_TEST_CASES: LiveCallTestCase[] = [
  {
    id: 'amazon-cs-long',
    name: 'Amazon CS (Long) — persist through verification loop to reach a human',
    description:
      'Amazon keeps pushing verification texts. AI must keep refusing until a human connects.',
    phoneNumber: '+18882804331',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 1000,
    },
  },
];

export const TEST_IVR_NUMBERS = [
  '+17208150797',
  '+17207909170',
  '+17206192779',
];

export const TEST_IVR_CASES: LiveCallTestCase[] = [
  {
    id: 'test-ivr-operator',
    name: 'Banking IVR - Operator (Press 0)',
    description: 'Root menu - press 0 for operator',
    phoneNumber: TEST_IVR_NUMBERS[0],
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      expectedDigits: ['0'],
      shouldReachHuman: true,
      requireConfirmedTransfer: true,
      maxDurationSeconds: 240,
    },
  },
  {
    id: 'test-ivr-activate-card',
    name: 'Banking IVR - Activate Card (1 → 1)',
    description: 'Card services → activate a card',
    phoneNumber: TEST_IVR_NUMBERS[0],
    callPurpose: 'activate my new debit card',
    expectedOutcome: {
      expectedDigits: ['1', '1'],
      shouldReachHuman: true,
      maxDurationSeconds: 240,
    },
  },
  {
    id: 'test-ivr-credit-billing',
    name: 'Banking IVR - Credit Card Billing (1 → 2 → 1)',
    description: 'Card services → billing → credit card',
    phoneNumber: TEST_IVR_NUMBERS[0],
    callPurpose: 'credit card billing',
    expectedOutcome: {
      expectedDigits: ['1', '2', '1'],
      shouldReachHuman: true,
      maxDurationSeconds: 240,
    },
  },
  {
    id: 'test-ivr-debit-billing',
    name: 'Banking IVR - Debit Card Billing (1 → 2 → 2)',
    description: 'Card services → billing → debit card',
    phoneNumber: TEST_IVR_NUMBERS[0],
    callPurpose: 'debit card billing',
    expectedOutcome: {
      expectedDigits: ['1', '2', '2'],
      shouldReachHuman: true,
      maxDurationSeconds: 240,
    },
  },
  {
    id: 'test-ivr-pending-dues',
    name: 'Banking IVR - Pending Dues (1 → 2 → 3)',
    description: 'Card services → billing → pending dues',
    phoneNumber: TEST_IVR_NUMBERS[0],
    callPurpose: 'pending dues on my account',
    expectedOutcome: {
      expectedDigits: ['1', '2', '3'],
      shouldReachHuman: true,
      maxDurationSeconds: 240,
    },
  },
  {
    id: 'test-ivr-stolen-card',
    name: 'Banking IVR - Stolen Card (1 → 3)',
    description: 'Card services → report stolen card',
    phoneNumber: TEST_IVR_NUMBERS[0],
    callPurpose: 'my card was stolen',
    expectedOutcome: {
      expectedDigits: ['1', '3'],
      shouldReachHuman: true,
      maxDurationSeconds: 240,
    },
  },
  {
    id: 'test-ivr-new-loan',
    name: 'Banking IVR - New Loan (2 → 1)',
    description: 'Loans → apply for new loan',
    phoneNumber: TEST_IVR_NUMBERS[0],
    callPurpose: 'apply for a home loan',
    expectedOutcome: {
      expectedDigits: ['2', '1'],
      shouldReachHuman: true,
      maxDurationSeconds: 240,
    },
  },
  {
    id: 'test-ivr-existing-loan',
    name: 'Banking IVR - Existing Loan (2 → 2)',
    description: 'Loans → existing loan status',
    phoneNumber: TEST_IVR_NUMBERS[0],
    callPurpose: 'check my existing loan status',
    expectedOutcome: {
      expectedDigits: ['2', '2'],
      shouldReachHuman: true,
      maxDurationSeconds: 240,
    },
  },
  {
    id: 'test-ivr-balance',
    name: 'Banking IVR - Check Balance (3 → 1)',
    description: 'Account services → check balance',
    phoneNumber: TEST_IVR_NUMBERS[0],
    callPurpose: 'check my account balance',
    expectedOutcome: {
      expectedDigits: ['3', '1'],
      shouldReachHuman: true,
      maxDurationSeconds: 240,
    },
  },
  {
    id: 'test-ivr-open-account',
    name: 'Banking IVR - Open Account (3 → 2)',
    description: 'Account services → open new account',
    phoneNumber: TEST_IVR_NUMBERS[0],
    callPurpose: 'open a new savings account',
    expectedOutcome: {
      expectedDigits: ['3', '2'],
      shouldReachHuman: true,
      maxDurationSeconds: 240,
    },
  },
  {
    id: 'test-ivr-close-account',
    name: 'Banking IVR - Close Account (3 → 3)',
    description: 'Account services → close account',
    phoneNumber: TEST_IVR_NUMBERS[0],
    callPurpose: 'close my account',
    expectedOutcome: {
      expectedDigits: ['3', '3'],
      shouldReachHuman: true,
      maxDurationSeconds: 240,
    },
  },
  {
    id: 'test-ivr-statements',
    name: 'Banking IVR - Statements (3 → 4)',
    description: 'Account services → request statements',
    phoneNumber: TEST_IVR_NUMBERS[0],
    callPurpose: 'request bank statements',
    expectedOutcome: {
      expectedDigits: ['3', '4'],
      shouldReachHuman: true,
      maxDurationSeconds: 240,
    },
  },
  {
    id: 'test-ivr-fraud',
    name: 'Banking IVR - Fraud (4 → immediate transfer)',
    description: 'Report fraud → immediate transfer to fraud dept',
    phoneNumber: TEST_IVR_NUMBERS[0],
    callPurpose: 'report fraudulent activity on my card',
    expectedOutcome: {
      expectedDigits: ['4'],
      shouldReachHuman: true,
      maxDurationSeconds: 240,
    },
  },
  {
    id: 'test-ivr-hold-with-lyrics',
    name: 'Banking IVR - Hold with vocal music (4 → fraud)',
    description:
      'Fraud path plays rock hold music with vocals/lyrics — AI must not confuse song lyrics with IVR prompts or human speech',
    phoneNumber: TEST_IVR_NUMBERS[0],
    callPurpose: 'report fraudulent activity on my card',
    expectedOutcome: {
      expectedDigits: ['4'],
      shouldReachHuman: true,
      requireConfirmedTransfer: true,
      maxDurationSeconds: 240,
    },
  },
];
