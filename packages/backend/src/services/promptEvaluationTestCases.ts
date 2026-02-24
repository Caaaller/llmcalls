/**
 * Prompt evaluation test case data
 * Kept separate from promptEvaluationService so logic and data can change independently.
 */

import type {
  PromptTestCase,
  MultiStepTestCase,
} from './promptEvaluationService';
import type { TransferConfig } from './aiService';

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
      description: 'Should detect customer service transfer request',
      speech: 'I need to speak with customer service',
      expectedBehavior: {
        shouldTransfer: true,
      },
    },
    {
      name: 'Transfer Request - Representative',
      description: 'Should detect representative transfer request',
      speech: 'Can I speak with a representative please?',
      expectedBehavior: {
        shouldTransfer: true,
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
      description: 'Should not press if no clear match found',
      speech: 'Press 1 for sales, press 2 for marketing',
      config: {
        callPurpose: 'technical support',
      },
      expectedBehavior: {
        shouldPressDTMF: false,
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
      name: 'No Termination - Business Hours',
      description:
        'Should NOT terminate when business hours are provided without closed status',
      speech: 'Our business hours are Monday through Friday 9 to 5',
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
    name: 'Loop Detection - NYU Langone Scenario',
    description:
      'Tests the actual looping scenario where same menu appears multiple times and DTMF 5 is pressed repeatedly',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          'Thank you for calling the NYU langone faculty group. Practice billing office. If you are calling to make a payment or discuss payment options, press 1 to inquire about the status of prior authorization,',
        expectedBehavior: {
          shouldPressDTMF: false, // Incomplete menu, should wait
        },
      },
      {
        speech: 'Press 5.',
        expectedBehavior: {
          shouldPressDTMF: false, // Just a digit fragment, no complete menu context
        },
      },
      {
        speech:
          "Ization, press 2 to request or discuss a financial estimate press 3. If you're calling from an insurance company or an attorney's office, press 4, all other inquiries press 5.",
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // May detect loop if similar to step 1 menu, that's OK
        },
      },
      {
        speech:
          "2 to request or discuss a financial estimate press 3. If you're calling from an insurance company or an attorney's office, press 4, all other inquiries press 5.",
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Same menu appearing again
          shouldNotPressAgain: true, // Should detect loop and NOT press again
        },
      },
      {
        speech:
          "Press 2 to request or discuss a financial estimate press 3. If you're calling from an insurance company or an attorney's office, press 4, all other inquiries press 5.",
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Same menu appearing again
          shouldNotPressAgain: true, // Should detect loop and NOT press again
        },
      },
    ],
  },
  {
    name: 'Loop Detection - Incomplete Menu Repeating',
    description: 'Tests when incomplete menu keeps repeating without option 5',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          "Press 2 to request or discuss a financial estimate press 3. If you're calling from an insurance company or an attorney's office, press 4.",
        expectedBehavior: {
          shouldPressDTMF: false, // No option 5, no clear match
        },
      },
      {
        speech:
          "To inquire about the status of prior authorization. Press 2 to request or discuss a financial estimate, press 3. If you're calling from an insurance company or an attorney's office press 4.",
        expectedBehavior: {
          shouldPressDTMF: false,
          shouldDetectLoop: false, // Option 2 changed significantly (from "financial estimate" to "prior authorization"), so not a loop
        },
      },
      {
        speech:
          "Press 2 to request or discuss a financial estimate press 3. If you're calling from an insurance company or an attorney's office, press 4.",
        expectedBehavior: {
          shouldPressDTMF: false,
          shouldDetectLoop: true, // Same menu as step 1 - this IS a loop
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
      'Tests the Costco scenario where menu keeps repeating with "press 5 for administrative staff" and system should stop pressing after detecting loop',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          'Press 5 to reach the administrative staff. Press 1 for warehouse hours directions and holidays, observed press 2 for information on membership or returns, press 3 to reach the pharmacy.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5', // First time, should press 5
        },
      },
      {
        speech:
          'Press, 3 to reach the pharmacy press 4 for all other departments, press 5.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '4', // Different menu, should press 4 for "all other departments"
        },
      },
      {
        speech: 'All other departments, press 5 to reach the administrator.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5', // Should press 5 for administrator
        },
      },
      {
        speech:
          'To reach the administrative staff. Press 1 for warehouse hours, directions and holidays, observed press 2 for information on membership or returns, press 3 to reach the pharmacy, press 4 for all other departments, press 5,',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Similar menu to step 1 - loop detected
        },
      },
      {
        speech:
          'Apartments press 5 to reach the administrative staff, press 1 for warehouse hours, directions and holidays, observed press 2 for information on membership or returns press 3.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Same menu pattern - loop detected
        },
      },
      {
        speech:
          'Or returns press 3 to reach the pharmacy, press 4 for all other departments, press 5.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Similar to step 2 - loop detected
        },
      },
      {
        speech:
          'Administrative staff, press 1 for warehouse hours directions and holidays. Observed press 2 for information on membership or returns, press 3 to reach the pharmacy.',
        expectedBehavior: {
          shouldPressDTMF: false, // No option 5, no clear match - should not press
          shouldDetectLoop: true, // Similar menu pattern - loop detected
        },
      },
      {
        speech:
          'On membership or returns press 3 to reach the pharmacy press 4 for all other departments press 5.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Same pattern as step 3 - loop detected
          shouldNotPressAgain: true, // If we already pressed 5 for this menu pattern, should NOT press again
        },
      },
      {
        speech:
          'Staff press 1 for warehouse hours, directions and holidays. Observed press 2 for information on membership or returns, press 3 to reach the pharmacy.',
        expectedBehavior: {
          shouldPressDTMF: false, // No option 5, no clear match
          shouldDetectLoop: true, // Same pattern as step 7 - loop detected
        },
      },
      {
        speech:
          'Returns press 3 to reach the pharmacy, press 4 for all other departments press 5.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Same pattern as step 6 and 8 - loop detected
          shouldNotPressAgain: true, // Should NOT press again if we already pressed 5 for this pattern
        },
      },
      {
        speech:
          '5 to reach the administrative staff. Press 1 for warehouse hours directions and holidays, observed press 2 for information on membership or returns, press 3 to reach the pharmacy.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Same pattern as step 1, 4, 5 - loop detected
          shouldNotPressAgain: true, // Should NOT press again if we already pressed 5 for this pattern
        },
      },
    ],
  },
];
