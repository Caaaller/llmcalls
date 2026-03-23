/**
 * Prompt evaluation test case data
 * Kept separate from promptEvaluationService so logic and data can change independently.
 */

import type {
  PromptTestCase,
  MultiStepTestCase,
} from './promptEvaluationService';
import type { TransferConfig } from '../types/voiceProcessing';

const DEFAULT_CALL_PURPOSE: Partial<TransferConfig> = {
  callPurpose: 'speak with a representative',
};

const singleStepCases: {
  transfer: PromptTestCase[];
  loopDetection: PromptTestCase[];
  dtmf: PromptTestCase[];
  termination: PromptTestCase[];
  callPurpose: PromptTestCase[];
} = {
  transfer: [
    {
      name: 'Transfer Request - Direct',
      description: 'Should detect direct transfer confirmation from system',
      speech: "I'm transferring you now to a representative",
      expectedBehavior: {
        shouldTransfer: true,
      },
    },
    {
      name: 'Transfer Request - Customer Service',
      description:
        'Should NOT detect transfer in caller-like speech (not a rep introducing themselves)',
      speech: 'I need to speak with customer service',
      expectedBehavior: {
        shouldTransfer: false,
      },
    },
    {
      name: 'Transfer Request - Representative',
      description:
        'Should NOT detect transfer in caller-like speech (not a rep introducing themselves)',
      speech: 'Can I speak with a representative please?',
      expectedBehavior: {
        shouldTransfer: false,
      },
    },
    {
      name: 'No Transfer - IVR Menu',
      description: 'Should NOT detect transfer in IVR menu options',
      speech: 'Press 1 for sales, press 2 for customer service',
      expectedBehavior: {
        shouldTransfer: false,
      },
    },
    {
      name: 'No Transfer - Greeting',
      description: 'Should NOT detect transfer in greeting',
      speech: 'Thank you for calling, how can I help you?',
      expectedBehavior: {
        shouldTransfer: false,
      },
    },
    {
      name: 'Maybe Human - Person introducing themselves after transfer',
      description:
        'Should trigger maybe_human when someone introduces themselves after transfer announced',
      speech:
        'Hi, my name is Sarah from customer service, how can I help you today?',
      transferAnnounced: true,
      expectedBehavior: {
        shouldConfirmHuman: true,
      },
    },
    {
      name: 'Human Confirmed - After confirmation question',
      description:
        'Should trigger human_detected when awaitingHumanConfirmation and person responds',
      speech: 'Yes, I am a representative, how can I help?',
      awaitingHumanConfirmation: true,
      expectedBehavior: {
        shouldTransfer: true,
      },
    },
    {
      name: 'Transfer Announced - Sets transferRequested',
      description:
        'Should detect transfer announcement and set transferRequested (system will mark transferAnnounced)',
      speech: 'Transferring you now. Please hold.',
      expectedBehavior: {
        shouldTransfer: true,
        shouldConfirmHuman: false,
      },
    },
  ],

  loopDetection: [
    {
      name: 'Loop Detection - Repeated Menu',
      description:
        'Should detect loop when same menu options appear twice and act immediately',
      speech:
        'Press 1 for sales, press 2 for support. Press 1 for sales, press 2 for support',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '2', // Should choose support as closest match to "representative"
      },
    },
    {
      name: 'Loop Detection - Single Option Repeat',
      description:
        'Should detect loop when single option repeats and press immediately',
      speech:
        'Press 0 for operator. Press 0 for operator. Press 0 for operator',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '0',
      },
    },
    {
      name: 'Loop Detection - Same Menu After DTMF Pressed',
      description:
        'Should detect when same menu appears after DTMF was already pressed (NYU Langone scenario)',
      speech:
        "Press 2 to request or discuss a financial estimate press 3. If you're calling from an insurance company or an attorney's office, press 4, all other inquiries press 5.",
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '5', // Should press 5 for "all other inquiries"
      },
    },
    {
      name: 'Loop Detection - Incomplete Menu Without Option 5',
      description:
        'Should handle incomplete menu that keeps repeating without "all other inquiries" option',
      speech:
        "Press 2 to request or discuss a financial estimate press 3. If you're calling from an insurance company or an attorney's office, press 4.",
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: false, // No clear match for representative
      },
    },
    {
      name: 'Loop Detection - Menu Fragment Continuation',
      description:
        'Should handle menu fragment that looks like continuation but is actually repeat',
      speech:
        "Ization, press 2 to request or discuss a financial estimate press 3. If you're calling from an insurance company or an attorney's office, press 4, all other inquiries press 5.",
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '5',
      },
    },
    {
      name: 'Loop Detection - Repeated Same Menu Options',
      description:
        'Should detect when exact same menu options appear multiple times (prevent infinite loop)',
      speech:
        "Press 2 to request or discuss a financial estimate press 3. If you're calling from an insurance company or an attorney's office, press 4, all other inquiries press 5.",
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '5',
      },
    },
    {
      name: 'Loop Detection - Incomplete Menu Repeating',
      description:
        'Should handle incomplete menu that keeps appearing without completing (status of prior authorization scenario)',
      speech:
        "Status of prior authorization. Press 2 to request or discuss a financial estimate, press 3. If you're calling from an insurance company or an attorney's office, press 4.",
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: false, // No option 5, no clear match
      },
    },
  ],

  dtmf: [
    {
      name: 'DTMF - Representative Option',
      description:
        'Should press correct digit for representative option when call purpose is to speak with someone',
      speech: 'Press 0 to speak with a representative, press 1 for sales',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '0',
      },
    },
    {
      name: 'DTMF - Customer Service Match',
      description: 'Should match call purpose to customer service menu option',
      speech: 'Press 1 for customer service, press 2 for billing',
      config: {
        callPurpose: 'customer service inquiry',
      },
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '1',
      },
    },
    {
      name: 'DTMF - No Clear Match',
      description:
        'Should press lowest digit when no option matches call purpose',
      speech: 'Press 1 for sales, press 2 for marketing',
      config: {
        callPurpose: 'technical support',
      },
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '1',
      },
    },
    {
      name: 'DTMF - Generic Other Option',
      description:
        'Should prefer "other" or "all other questions" option when no specific match',
      speech:
        'Press 1 for sales, press 2 for support, press 5 for all other questions',
      config: {
        callPurpose: 'general inquiry',
      },
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '5',
      },
    },
    {
      name: 'DTMF - Wells Fargo Loan Number Prompt',
      description:
        'Should NOT press any DTMF when prompted only for loan number entry',
      speech:
        'To avoid waiting to get started, please enter your loan number followed by pound.',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: false,
      },
    },
    {
      name: 'DTMF - Wells Fargo Representative Option',
      description:
        'Should press 2 when instructed to press 2 to reach an agent after loan-number prompts',
      speech: 'Press 2 to speak with a representative.',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '2',
      },
    },
    {
      name: 'DTMF - Home Depot Representative Option',
      description:
        'Home Depot IVR: should press 6 for customer care when speaking with a rep',
      speech:
        'For in-home services and installations press 1. For help with new or existing orders, product questions, or help with our website press 2. For appliance orders or questions press 3. Press 4 for Home Depot protection plans. Press 5 for credit card services. Press 6 for customer care.',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '6',
      },
    },
    {
      name: 'DTMF - Verizon FiOS Honesty Over Shortcut',
      description:
        'Should NOT press # for "new customer" when caller is not a new customer — should say "I don\'t have one" instead',
      speech:
        "Or account number associated with the question, you are calling about to become a new customer. You can say new customer or press the pound key, or you can say, I don't have 1.",
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: false, // Should say "I don't have one" verbally, not press # for new customer
      },
    },
    {
      name: 'DTMF - DJI No False Catch-All',
      description:
        'Should NOT pick "existing order" (9) when purpose is to speak with a rep — any tech support option (1, 2, 3) or care plans (4) is acceptable',
      speech:
        'For technical support of camera drones and DJI power. Press 1 for technical support of handheld products, press 2 for technical support of enterprise products press 3. DJI care service plans, press 4. To inquire an existing order on DJI online store press 9, press the pound key to listen to this message again.',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: true,
        // Any of 1, 2, 3, 4 is acceptable — just NOT 9 (existing order) or # (repeat)
      },
    },
  ],

  termination: [
    {
      name: 'Termination - Voicemail',
      description: 'Should detect voicemail and terminate',
      speech: 'Please leave a message after the beep',
      expectedBehavior: {
        shouldTerminate: true,
        terminationReason: 'voicemail',
      },
    },
    {
      name: 'Termination - Business Closed',
      description: 'Should detect business closed and terminate',
      speech:
        'We are currently closed. Our hours are Monday through Friday 9 to 5',
      expectedBehavior: {
        shouldTerminate: true,
        terminationReason: 'closed_no_menu',
      },
    },
    {
      name: 'Termination - Office Closed with Menu Options',
      description:
        'Should terminate when office is closed even if menu options are provided (automated systems)',
      speech:
        'Our office is currently closed. If you would like to hear your current balance or make a payment now, press 1 for our automated system.',
      expectedBehavior: {
        shouldTerminate: true,
        terminationReason: 'closed_no_menu',
      },
    },
    {
      name: 'Termination - Office Closed with Payment Options',
      description:
        'Should terminate when office is closed even with payment/balance options',
      speech:
        'Calling NYU langone faculty group, practice billing office. Our office is currently closed. If you would like to hear your current balance or make a payment now, press 1 for our automated system.',
      expectedBehavior: {
        shouldTerminate: true,
        terminationReason: 'closed_no_menu',
      },
    },
    {
      name: 'Termination - DirecTV Closed Message',
      description:
        'Should terminate when DirecTV says offices are closed with website redirect',
      speech:
        'Welcome to Direct TV. Our offices are currently closed. Please go to directv.com.',
      expectedBehavior: {
        shouldTerminate: true,
        terminationReason: 'closed_no_menu',
      },
    },
    {
      name: 'Termination - Wells Fargo Closed Message',
      description:
        'Should terminate when Wells Fargo home mortgage says offices are closed with no human options',
      speech:
        'Thank you for calling Wells, Fargo. Home mortgage. Our offices are currently closed. No one is available to take your call. Please call us back during our regular business hours Monday through Friday. To hear our hours again, press 8.',
      expectedBehavior: {
        shouldTerminate: true,
        terminationReason: 'closed_no_menu',
      },
    },
    {
      name: 'No Termination - Business Hours',
      description:
        'Should NOT terminate when business hours are provided without closed status',
      speech: 'Our business hours are Monday through Friday 9 to 5',
      expectedBehavior: {
        shouldTerminate: false,
      },
    },
    {
      name: 'No Termination - Garbled Speech Fragment',
      description:
        'Should NOT terminate on short garbled speech fragments from speech recognition errors',
      speech: 'The.',
      previousSpeech:
        'If you are interested in help purchasing a new product say sales or press 1. If you need support with a product you already own say support or press 2.',
      expectedBehavior: {
        shouldTerminate: false,
      },
    },
  ],

  callPurpose: [
    {
      name: 'Call Purpose - Custom Instructions',
      description:
        'Should expand custom instructions into natural conversation',
      speech: 'How can I help you today?',
      config: {
        callPurpose: 'check order status',
        customInstructions: 'Order number is 12345',
      },
      expectedBehavior: {
        expectedCallPurpose: 'order status',
      },
    },
    {
      name: 'Call Purpose - Default Purpose',
      description:
        'Should use default call purpose when no custom instructions',
      speech: 'What is the purpose of your call?',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        expectedCallPurpose: 'representative',
      },
    },
  ],
};

export const SINGLE_STEP_TEST_CASES: PromptTestCase[] = [
  ...singleStepCases.transfer,
  ...singleStepCases.loopDetection,
  ...singleStepCases.dtmf,
  ...singleStepCases.termination,
  ...singleStepCases.callPurpose,
];

export const MULTI_STEP_TEST_CASES: MultiStepTestCase[] = [
  {
    name: 'Loop Detection - NYU Langone',
    description:
      'Hear a menu, hear it again → loopDetected should be true on the repeat',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          "Thank you for calling the NYU Langone faculty group practice billing office. If you are calling to make a payment or discuss payment options, press 1. To inquire about the status of prior authorization, press 2. To request or discuss a financial estimate, press 3. If you're calling from an insurance company or an attorney's office, press 4. All other inquiries, press 5.",
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
        },
      },
      {
        speech:
          "If you are calling to make a payment or discuss payment options, press 1. To inquire about the status of prior authorization, press 2. To request or discuss a financial estimate, press 3. If you're calling from an insurance company or an attorney's office, press 4. All other inquiries, press 5.",
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true,
        },
      },
    ],
  },
  {
    name: 'Loop Detection - Incomplete Menu Repeating',
    description:
      'Hear a partial menu twice → loopDetected should be true on the repeat',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          "Press 2 to request or discuss a financial estimate, press 3. If you're calling from an insurance company or an attorney's office, press 4.",
        expectedBehavior: {
          shouldPressDTMF: false,
        },
      },
      {
        speech:
          "Press 2 to request or discuss a financial estimate, press 3. If you're calling from an insurance company or an attorney's office, press 4.",
        expectedBehavior: {
          shouldDetectLoop: true,
        },
      },
    ],
  },
  {
    name: 'Wells Fargo - Loan Number Then Representative',
    description:
      'Should wait on incomplete loan number menu, then press 2 for representative when full menu appears',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          'Your loan number or social security number is required to access your account. Using your loan number, press 1.',
        expectedBehavior: {
          shouldPressDTMF: false, // Incomplete menu — only one option, wait for more
        },
      },
      {
        speech: 'Press 2 to speak with a representative.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '2',
        },
      },
    ],
  },
  {
    name: 'DirecTV - Complete Call Flow with Termination',
    description:
      'Tests the complete DirecTV call flow: greeting, multiple menu navigations, human interaction, phone number request, service type question, and final termination when office is closed',
    config: {
      callPurpose: 'speak with a representative',
      customInstructions: 'billing question',
    },
    steps: [
      {
        speech: 'Thank you for calling DirecTV.',
        expectedBehavior: {
          shouldPressDTMF: false, // Greeting, should remain silent
        },
      },
      {
        speech:
          "TV account. I didn't understand that. Would you like to speak with the sales agent to establish a new DirecTV account? You can say yes or press 1 or you can say no.",
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '1', // Should press 1 for sales agent (closest to representative)
        },
      },
      {
        speech:
          'Agent to establish a new DirecTV account. You can say yes or press 1 or you can say no or press 2.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '1', // Should press 1 for agent option
        },
      },
      {
        speech: 'The account, press 1, otherwise press 2.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '2', // Should press 2 for "otherwise" (more likely to lead to representative)
        },
      },
      {
        speech: "I didn't hear anything. Do you still need our assistance?",
        expectedBehavior: {
          shouldPressDTMF: false, // Human question, should respond verbally
        },
      },
      {
        speech: 'In a few words, tell me how I can help you.',
        expectedBehavior: {
          shouldPressDTMF: false, // Human question, should respond with billing question
        },
      },
      {
        speech:
          "Please enter the 10 digit phone number associated with your service, or if you don't know, it, press star.",
        expectedBehavior: {
          shouldPressDTMF: false, // Should SPEAK the phone number, not press star
        },
      },
      {
        speech:
          'Are you calling about your DirecTV satellite or streaming service?',
        expectedBehavior: {
          shouldPressDTMF: false, // Human question, should respond verbally
        },
      },
      {
        speech:
          'Welcome to Direct TV. Our offices are currently closed. Please go to directv.com.',
        expectedBehavior: {
          shouldPressDTMF: false,
          shouldTerminate: true, // Should terminate when office is closed
          terminationReason: 'closed_no_menu',
        },
      },
    ],
  },
  {
    name: 'Costco - Administrative Staff Loop',
    description:
      'Hear Costco menu, hear it again → loopDetected should be true and AI should keep pressing',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          'To reach the administrative staff press 5. For warehouse hours, directions and holidays press 1. For information on membership or returns press 2. To reach the pharmacy press 3. For all other departments press 4.',
        expectedBehavior: {
          shouldPressDTMF: true,
        },
      },
      {
        speech:
          'To reach the administrative staff press 5. For warehouse hours, directions and holidays press 1. For information on membership or returns press 2. To reach the pharmacy press 3. For all other departments press 4.',
        expectedBehavior: {
          shouldPressDTMF: true,
          shouldDetectLoop: true,
        },
      },
    ],
  },
  {
    name: 'Loop Detection - STT Garbling Variation',
    description:
      'Menu repeats with slightly different wording from STT garbling → loopDetected should still be true',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          'For pharmacy press 1. For the dental clinic press 2. To speak with a nurse press 3. For billing inquiries press 4. For all other questions press 5.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
        },
      },
      {
        speech:
          'For the pharmacy press 1. For dental clinic press 2. To speak with the nurse press 3. For billing inquiry press 4. For all other questions press 5.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true,
        },
      },
    ],
  },
];
