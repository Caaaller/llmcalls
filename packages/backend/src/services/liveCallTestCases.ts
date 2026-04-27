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

/**
 * Self-call simulator case.
 *
 * BLOCKED by Known Issue #D: Telnyx's cross-app stream fork delivers
 * garbage audio (constant-energy noise, not the actual call audio). The
 * recording pipeline works but the WebSocket stream pipeline doesn't —
 * confirmed via ffprobe + Deepgram HTTP comparison on a downloaded
 * failed call. Audio analysis: stream dump RMS 3647-4705 uniform across
 * 9s, recording RMS 1 in pauses / 1179-2309 during speech.
 *
 * Equivalent pipeline validation is now done by
 * `humanDetectionPipeline.test.ts` (synthetic transcripts → processSpeech
 * → state machine assertions) with zero Telnyx dependency.
 *
 * This live fixture is gated off by default. Re-enable with
 * `ENABLE_SELF_CALL_SIMULATOR=1` only when testing Telnyx fixes.
 */
const SIMULATOR_CASES: LiveCallTestCase[] =
  process.env.TELNYX_SIMULATOR_NUMBER &&
  process.env.ENABLE_SELF_CALL_SIMULATOR === '1'
    ? [
        {
          id: 'self-call-human-greeting',
          name: 'Self-call simulator — AI detects human greeting and confirms',
          description:
            'Places a call to our own simulator DID which auto-answers with a randomized "human agent" greeting. BLOCKED by Telnyx cross-app stream-fork audio corruption — see Known Issue #D in CHANGES-LOG. Use humanDetectionPipeline.test.ts for equivalent state-machine validation without the Telnyx dependency.',
          phoneNumber: process.env.TELNYX_SIMULATOR_NUMBER as string,
          callPurpose: 'Test call to the simulator agent',
          expectedOutcome: {
            shouldReachHuman: true,
            requireConfirmedTransfer: true,
            maxDurationSeconds: 60,
          },
        },
      ]
    : [];

export const DEFAULT_TEST_CASES: LiveCallTestCase[] = [
  ...SIMULATOR_CASES,
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
      'USPS IVR. AI must navigate menus and reach a hold queue. Previously required a confirmed transfer, but USPS daytime waits are unpredictable (10+ min) and the test would time out even when everything worked up to the hold. Reaching hold is the meaningful success criterion here; the "is this actually a human?" question is validated separately by the self-call test.',
    phoneNumber: '+18002758777',
    callPurpose:
      "Failed package pickup. Pickup request EMC717292788 was marked as completed even though it didn't actually happen",
    expectedOutcome: {
      shouldReachHuman: true,
      requireConfirmedTransfer: false,
      maxDurationSeconds: 300,
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
  {
    id: 'hulu-cs',
    name: 'Hulu CS — straight-to-hold streaming support',
    description:
      'Hulu has no menu — the line goes straight to a hold queue for a representative. Validates the simple "wait for human" path with no DTMF or speech navigation.',
    phoneNumber: '+18774858411',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 300,
    },
  },
  {
    id: 'tmobile-cs',
    name: 'T-Mobile CS — conversational IVR + DTMF menu to reach a human',
    description:
      'T-Mobile starts with conversational AI ("how can I help today?"), then a DTMF menu without a "representative" option (Home Internet / prepaid / business / new service). AI must navigate the menu and reach a hold queue. Original directory tip said "spam #" but the IVR has been redesigned — assertion intentionally does not pin specific digits.',
    phoneNumber: '+18774531304',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 300,
    },
  },
  {
    id: 'optimum-cs',
    name: 'Optimum (Cablevision) CS — language select then account-phone lookup',
    description:
      'Optimum requires language selection up front, then asks for the account phone number before routing to a human. Tests language-selection mechanic plus account-phone entry.',
    phoneNumber: '+18662183025',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 300,
    },
  },
  {
    id: 'directv-cs',
    name: 'DirecTV CS — pure speech yes/no IVR',
    description:
      'DirecTV uses a speech-only IVR — the AI must say "Yes" and wait. No DTMF available. Different from UMR (keyword Q&A) and Walmart (conversational AI bypass).',
    phoneNumber: '+18887772454',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 300,
    },
  },
  {
    id: 'lg-cs',
    name: 'LG CS — multi-stage speech routing',
    description:
      'LG asks for "customer service" via speech, then a device name (e.g. "TV", "phone") via speech. Tests multi-stage speech-to-speech routing.',
    phoneNumber: '+18002430000',
    callPurpose: 'speak with a representative about a TV',
    customInstructions:
      'When asked what kind of product, say "TV". Use short keyword answers throughout.',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDurationSeconds: 300,
    },
  },
  // valve-voicemail removed 2026-04-26: number +14258899642 no longer answers
  // (Telnyx call ended is_alive=false, no MongoDB record, no recording). The
  // negative-test assertion (`!transferred && !onHold`) false-passes on
  // inactivity, indistinguishable from real voicemail detection. A negative
  // test needs (a) a target that reliably answers with voicemail, and (b) a
  // positive signal in the assertion (e.g. AI emitted a "voicemail_detected"
  // termination event). Until both are in place, no negative test.
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
