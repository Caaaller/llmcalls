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
  humanDetectionInitial: PromptTestCase[];
  humanConfirmationHappy: PromptTestCase[];
  humanConfirmationEdge: PromptTestCase[];
  humanClarification: PromptTestCase[];
  holdDetection: PromptTestCase[];
  callbackOffer: PromptTestCase[];
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
      description: 'Should NOT detect transfer or human in IVR greeting',
      speech: 'Thank you for calling, how can I help you?',
      expectedBehavior: {
        shouldTransfer: false,
        shouldConfirmHuman: false,
      },
    },
    {
      name: 'Maybe Human - Person introducing themselves after transfer',
      description:
        'Clear personal intro ("My name is Sarah") → maybe_human to trigger mandatory confirmation question before transferring.',
      speech:
        'Hi, my name is Sarah from customer service, how can I help you today?',
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
        'Should detect transfer announcement and set transferRequested in the detected output',
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

  humanDetectionInitial: [
    {
      name: 'Human Detection - Unexpected greeting',
      description:
        'Conversational greeting WITHOUT a name (could be bot or human) — answer with call purpose. If it is a human, they will introduce themselves on next turn.',
      speech: 'Hi, how can I help you today?',
      expectedBehavior: {
        shouldTransfer: false,
        shouldConfirmHuman: false,
      },
    },
    {
      name: 'Human Detection - Introduces by name',
      description:
        'Agent introducing themselves by name → maybe_human to trigger mandatory confirmation question.',
      speech: 'Hi, my name is Sarah, how can I help?',
      expectedBehavior: { shouldConfirmHuman: true },
    },
    {
      name: 'Human Detection - Short hello',
      description:
        'Just "Hello?" could be human or bot. Ambiguous — maybe_human to confirm.',
      speech: 'Hello?',
      expectedBehavior: { shouldConfirmHuman: true },
    },
    {
      name: 'Human Detection - Asks for account info',
      description:
        'Asking for account info WITHOUT an introduction — could be bot (USPS IVR asks this too). Respond with call purpose.',
      speech: 'Can I get your account number?',
      expectedBehavior: {
        shouldTransfer: false,
        shouldConfirmHuman: false,
      },
    },
    {
      name: 'Human Detection - Agent with department',
      description:
        'Name + department introduction ("this is Mike") → maybe_human to trigger confirmation question.',
      speech: 'Customer service, this is Mike',
      expectedBehavior: { shouldConfirmHuman: true },
    },
    {
      name: 'Human Detection - Casual speech',
      description:
        'Casual conversational speech WITHOUT a name — could be bot. Respond with call purpose.',
      speech: 'Yeah, hi, what do you need help with?',
      expectedBehavior: {
        shouldTransfer: false,
        shouldConfirmHuman: false,
      },
    },
  ],

  humanConfirmationHappy: [
    {
      name: 'Confirmation - Clear yes',
      description:
        'Clear affirmative after confirmation question → human_detected',
      speech: 'Yes, you are. How can I help you?',
      awaitingHumanConfirmation: true,
      expectedBehavior: { shouldTransfer: true },
    },
    {
      name: 'Confirmation - Short yes',
      description: 'Just "yes" after confirmation question → human_detected',
      speech: 'Yes',
      awaitingHumanConfirmation: true,
      expectedBehavior: { shouldTransfer: true },
    },
    {
      name: 'Confirmation - Casual yeah',
      description: 'Casual "yeah" after confirmation → human_detected',
      speech: 'Yeah, what do you need?',
      awaitingHumanConfirmation: true,
      expectedBehavior: { shouldTransfer: true },
    },
    {
      name: 'Confirmation - Name introduction',
      description:
        'Introduces themselves in response to confirmation → human_detected',
      speech: 'This is Sarah, yes, how can I help?',
      awaitingHumanConfirmation: true,
      expectedBehavior: { shouldTransfer: true },
    },
    {
      name: 'Confirmation - Im here',
      description: 'Confirms presence → human_detected',
      speech: "I'm here, go ahead",
      awaitingHumanConfirmation: true,
      expectedBehavior: { shouldTransfer: true },
    },
    {
      name: 'Confirmation - Who is this',
      description: 'Suspicious but clearly human → human_detected',
      speech: 'Who is this? What are you calling about?',
      awaitingHumanConfirmation: true,
      expectedBehavior: { shouldTransfer: true },
    },
    {
      name: 'Confirmation - Can you hold',
      description: 'Human confirmed but asks to wait → human_detected',
      speech: 'Yes, can you hold on for just a moment?',
      awaitingHumanConfirmation: true,
      expectedBehavior: { shouldTransfer: true },
    },
    {
      name: 'Confirmation - Garbled hesitant',
      description: 'Filler words and hesitation = human → human_detected',
      speech: 'Uh... yeah... sorry...',
      awaitingHumanConfirmation: true,
      expectedBehavior: { shouldTransfer: true },
    },
    {
      name: 'Confirmation - Repeats question back',
      description: 'Echoes our question then confirms → human_detected',
      speech: 'A live agent? Yes, this is customer support.',
      awaitingHumanConfirmation: true,
      expectedBehavior: { shouldTransfer: true },
    },
    {
      name: 'Confirmation - What huh',
      description: 'Confused "What?" is clearly human → human_detected',
      speech: 'What? Huh?',
      awaitingHumanConfirmation: true,
      expectedBehavior: { shouldTransfer: true },
    },
    {
      name: 'Confirmation - Turns question back',
      description:
        'Asking "Are YOU a live agent?" is clearly human → human_detected',
      speech: 'Are you a live agent? Who is calling?',
      awaitingHumanConfirmation: true,
      expectedBehavior: { shouldTransfer: true },
    },
  ],

  humanConfirmationEdge: [
    {
      name: 'Confirmation Edge - IVR menu instead',
      description:
        'Got IVR menu after confirmation question → back to navigation',
      speech: 'Press 1 for sales, press 2 for support',
      awaitingHumanConfirmation: true,
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: { shouldPressDTMF: true, shouldTransfer: false },
    },
    {
      name: 'Confirmation Edge - Hold message',
      description:
        'Got hold message after confirmation question → back to waiting',
      speech: 'Please continue to hold. Your call is important to us.',
      awaitingHumanConfirmation: true,
      expectedBehavior: { shouldTransfer: false, shouldConfirmHuman: false },
    },
    {
      name: 'Confirmation Edge - Virtual assistant',
      description:
        'Bot self-identifies as virtual assistant during confirmation → NOT a human, do not transfer. Return wait/speak to continue IVR flow.',
      speech: "I'm a virtual assistant. I can help you with many things.",
      awaitingHumanConfirmation: true,
      expectedBehavior: { shouldTransfer: false, shouldConfirmHuman: false },
    },
    {
      name: 'Confirmation Edge - Unclear mumble',
      description:
        'Unintelligible mumble "... mmhm ..." during confirmation → ambiguous, return maybe_human_unclear to ask more directly.',
      speech: '... mmhm ...',
      awaitingHumanConfirmation: true,
      expectedBehavior: {
        shouldConfirmHumanUnclear: true,
        shouldTransfer: false,
      },
    },
    {
      name: 'Confirmation Edge - No response',
      description:
        '"No" in response to confirmation is still a human speaking — transfer',
      speech: 'No.',
      awaitingHumanConfirmation: true,
      expectedBehavior: { shouldTransfer: true },
    },
    {
      name: 'Confirmation Edge - Scripted hold sounds human',
      description: 'Recorded message that sounds human-ish but is scripted',
      speech:
        'A representative will be with you shortly. Please continue to hold.',
      awaitingHumanConfirmation: true,
      expectedBehavior: { shouldTransfer: false, shouldConfirmHuman: false },
    },
  ],

  humanClarification: [
    {
      name: 'Clarification - Clear yes',
      description: 'Clear confirmation after 2nd question → human_detected',
      speech: "I'm a real person, yes",
      awaitingHumanClarification: true,
      expectedBehavior: { shouldTransfer: true },
    },
    {
      name: 'Clarification - Frustrated but human',
      description:
        'Annoyed at being asked twice → definitely human → human_detected',
      speech: 'Yes! I already told you, how can I help?',
      awaitingHumanClarification: true,
      expectedBehavior: { shouldTransfer: true },
    },
    {
      name: 'Clarification - Im human',
      description: 'Direct answer to direct question → human_detected',
      speech: "I'm human, what do you need help with?",
      awaitingHumanClarification: true,
      expectedBehavior: { shouldTransfer: true },
    },
    {
      name: 'Clarification - Bot identifies itself',
      description: 'Bot confirms automated → back to IVR',
      speech:
        'I am an automated system. For billing press 1, for support press 2.',
      awaitingHumanClarification: true,
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: { shouldPressDTMF: true, shouldTransfer: false },
    },
    {
      name: 'Clarification - Still unclear give up',
      description: 'After 2 questions still unclear → give up, back to normal',
      speech: '... please hold ...',
      awaitingHumanClarification: true,
      expectedBehavior: {
        shouldTransfer: false,
        shouldConfirmHuman: false,
        shouldConfirmHumanUnclear: false,
      },
    },
    {
      name: 'Clarification - What huh confused',
      description: 'Confused response to 2nd question is clearly human',
      speech: 'What are you talking about? I need help with my account.',
      awaitingHumanClarification: true,
      expectedBehavior: { shouldTransfer: true },
    },
  ],

  holdDetection: [
    {
      name: 'Not Human - Speech IVR prompt',
      description: 'Speech-recognition IVR is scripted, not human',
      speech: 'In a few words, tell me how I can help you',
      expectedBehavior: { shouldConfirmHuman: false, shouldPressDTMF: false },
    },
    {
      name: 'Not Human - Hold message',
      description:
        'Scripted hold message should trigger wait, not human detection',
      speech: 'Your call is important to us. Please continue to hold.',
      expectedBehavior: { shouldConfirmHuman: false, shouldPressDTMF: false },
    },
    {
      name: 'Not Human - IVR menu',
      description: 'Clear IVR menu should trigger DTMF',
      speech: 'Press 1 for billing, press 2 for support',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: { shouldConfirmHuman: false, shouldPressDTMF: true },
    },
    {
      name: 'Not Human - Robotic transition',
      description: 'Short scripted transition should wait',
      speech: 'Thank you. One moment please.',
      expectedBehavior: { shouldConfirmHuman: false, shouldPressDTMF: false },
    },
    {
      name: 'Not Human - Quality monitoring message',
      description:
        'Pre-human recorded message should not trigger human detection',
      speech:
        'This call may be monitored or recorded for quality and training purposes.',
      expectedBehavior: { shouldConfirmHuman: false, shouldPressDTMF: false },
    },
    {
      name: 'Not Human - Representative will be with you',
      description: 'Scripted hold message that sounds human but is recorded',
      speech:
        'A representative will be with you shortly. Please continue to hold.',
      expectedBehavior: { shouldConfirmHuman: false, shouldPressDTMF: false },
    },
  ],

  callbackOffer: [
    {
      name: 'Callback Offer - requireLiveAgent=true stays on queue',
      description:
        'USPS-style callback-vs-queue fork. When requireLiveAgent=true the AI MUST stay on the queue (press 2), NOT register a callback (press 1). Registering a callback is a dead-end for this test.',
      speech:
        "Your estimated wait time is five minutes. All of our representatives are assisting other callers. Rather than wait on hold, we can call you back when it's your turn. Press 1 to register a callback. Press 2 to remain on queue.",
      config: DEFAULT_CALL_PURPOSE,
      requireLiveAgent: true,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '2',
      },
    },
    {
      name: 'Callback Offer - requireLiveAgent=false accepts callback',
      description:
        'Normal user call: callback offered instead of waiting on hold. Default behavior should accept it (press 1) since a callback is faster for the user.',
      speech:
        "Your estimated wait time is five minutes. All of our representatives are assisting other callers. Rather than wait on hold, we can call you back when it's your turn. Press 1 to register a callback. Press 2 to remain on queue.",
      config: DEFAULT_CALL_PURPOSE,
      requireLiveAgent: false,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '1',
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
  ...singleStepCases.humanDetectionInitial,
  ...singleStepCases.humanConfirmationHappy,
  ...singleStepCases.humanConfirmationEdge,
  ...singleStepCases.humanClarification,
  ...singleStepCases.holdDetection,
  ...singleStepCases.callbackOffer,
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
  {
    name: 'Hold Then Human Pickup',
    description:
      'On hold, then human picks up with clear introduction → maybe_human to trigger mandatory confirmation question before transferring.',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech: 'Please hold while I transfer you to the next available agent.',
        expectedBehavior: {
          shouldPressDTMF: false,
          shouldConfirmHuman: false,
        },
      },
      {
        speech: 'Hi this is Mike, how can I help you?',
        expectedBehavior: {
          shouldConfirmHuman: true,
        },
      },
    ],
  },
  {
    name: 'Hold Then More IVR',
    description: 'On hold, then IVR menu appears — should navigate normally',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech: 'All agents are busy. Please hold.',
        expectedBehavior: {
          shouldPressDTMF: false,
          shouldConfirmHuman: false,
        },
      },
      {
        speech: 'Press 1 for billing, press 2 for support',
        expectedBehavior: {
          shouldPressDTMF: true,
          shouldConfirmHuman: false,
        },
      },
    ],
  },
  {
    name: 'Queue Position Then Human',
    description:
      'Queue position announced, then someone picks up. "Hello, are you still there?" — no clear name — should be maybe_human to confirm.',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          'Your estimated wait time is 5 minutes. Caller number 3 in queue.',
        expectedBehavior: {
          shouldPressDTMF: false,
          shouldConfirmHuman: false,
        },
      },
      {
        speech: 'Hello, are you still there?',
        expectedBehavior: {
          shouldConfirmHuman: true,
        },
      },
    ],
  },
  {
    name: 'Menu With Hold Phrase Then Human',
    description:
      'IVR menu with hold phrase, then human says "this is customer service" (no proper name — just a department). Ambiguous — should be maybe_human.',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          'Your call is important. Press 1 for sales, press 2 for support.',
        expectedBehavior: {
          shouldPressDTMF: true,
          shouldConfirmHuman: false,
        },
      },
      {
        speech: 'Hi, this is customer service',
        expectedBehavior: {
          shouldConfirmHuman: true,
        },
      },
    ],
  },
  {
    name: 'Walmart Bot Self-Identifies During Confirmation',
    description:
      'Walmart AI bot keeps talking conversationally. AI should engage with its questions (not transfer) and never transfer to the bot itself. Three exchanges where AI responds with its purpose/call topic instead of transferring.',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          "I see you wanna speak with a representative. I'll do my best to help you out right now. What can I help you with?",
        expectedBehavior: {
          shouldTransfer: false,
        },
      },
      {
        speech:
          "You're speaking with Walmart's AI powered customer care agent. I can help with most things you'd need from customer care.",
        expectedBehavior: {
          shouldTransfer: false,
        },
      },
      {
        speech:
          "I'm a virtual assistant. I can help you with returns, order tracking, and more.",
        expectedBehavior: {
          shouldTransfer: false,
        },
      },
    ],
  },
  {
    name: 'Human Intro Mid-Call — "My name is Jeremy" after hold',
    description:
      'After hold queue, a real agent picks up and introduces themselves. Should return maybe_human to trigger the confirmation question — do NOT skip confirmation just because a name is present. Transfer happens only after confirmation.',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          'Please stay on the line while I check the availability of our agents.',
        expectedBehavior: {
          shouldTransfer: false,
        },
      },
      {
        speech:
          'Thank you for calling. My name is Jeremy. May I have your name, please?',
        expectedBehavior: {
          shouldConfirmHuman: true,
        },
      },
    ],
  },
  {
    name: 'Human Intro Mid-Call — "You\'re through to Bendulo" (STT garbled)',
    description:
      'Agent introduces with variation "You\'re through to [Name]". AI should return maybe_human to trigger the mandatory confirmation question before transferring.',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech: 'please hold for the next available agent.',
        expectedBehavior: {
          shouldTransfer: false,
        },
      },
      {
        speech:
          "Pest Pie. You're through to Bendulo. How may I assist you today?",
        expectedBehavior: {
          shouldConfirmHuman: true,
        },
      },
    ],
  },
  {
    name: 'Phone Number Echo-Back Confirmation (IVR confirms our number)',
    description:
      'We provided our phone number in a previous turn. IVR echoes it back asking yes/no. Should say "yes" because the number matches what we just provided. Previously the AI wrongly said "no" confusing this with the "auto-detected caller ID" case.',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          "Please tell me the number you'd like me to use. Or use your telephone keypad to enter it beginning with the area code.",
        expectedBehavior: {
          // AI should speak the phone number
          shouldTransfer: false,
        },
      },
      {
        speech:
          'That was (720) 584-6358. If this is correct, say yes. Otherwise, say no.',
        expectedBehavior: {
          // AI should say "yes" because it just provided 720-584-6358
          shouldTransfer: false,
        },
      },
    ],
  },
  {
    name: 'Phone Number Auto-Detection (unprompted caller ID read-back)',
    description:
      'IVR reads back a phone number WITHOUT us having provided one. This is auto-detected caller ID from our outbound line — wrong number. Should say "no" or pick the reenter option.',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          'Welcome to Acme Support. Your phone number has been recorded as (303) 551-8171. Press 1 if correct, press 2 to reenter.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '2',
        },
      },
    ],
  },
  {
    name: 'Best Buy Virtual Assistant Self-Identifies',
    description:
      "Best Buy virtual assistant conversational flow. AI should respond with call purpose to bot's questions, never transfer to the bot itself.",
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech: 'Now what can I help you with?',
        expectedBehavior: {
          shouldTransfer: false,
        },
      },
      {
        speech:
          "I'm a virtual assistant, and I can help route your call to the right place. What can I help you with?",
        expectedBehavior: {
          shouldTransfer: false,
        },
      },
    ],
  },
];
