/**
 * Test IVR Routes - Data-driven banking IVR simulation
 *
 * Comprehensive 3-level IVR tree for testing AI navigation.
 * Mount under /voice/test-ivr prefix.
 *
 * Test call purposes (use these as callPurpose when initiating calls):
 *
 * - "speak with a representative"           → root: press 0 (operator)
 * - "activate my new debit card"            → 1 (cards) → 1 (activate)
 * - "debit card billing"                    → 1 (cards) → 2 (billing) → 2 (debit)
 * - "credit card billing"                   → 1 (cards) → 2 (billing) → 1 (credit)
 * - "pending dues on my account"            → 1 (cards) → 2 (billing) → 3 (pending)
 * - "my card was stolen"                    → 1 (cards) → 3 (stolen) OR 4 (fraud)
 * - "apply for a home loan"                 → 2 (loans) → 1 (new loan) or 3 (mortgage)
 * - "check my existing loan status"         → 2 (loans) → 2 (existing)
 * - "check my account balance"              → 3 (accounts) → 1 (balance)
 * - "open a new savings account"            → 3 (accounts) → 2 (open)
 * - "close my account"                      → 3 (accounts) → 3 (close)
 * - "request bank statements"               → 3 (accounts) → 4 (statements)
 * - "report fraudulent activity on my card" → 4 (fraud) → immediate transfer
 */

import express, { Request, Response } from 'express';
import twilio from 'twilio';

const router: express.Router = express.Router();

const GATHER_TIMEOUT = 30;
const HOLD_MUSIC_ROCK =
  'http://com.twilio.music.rock.s3.amazonaws.com/nickleus_-_original_guitar_song_200907251723.mp3';
const VOICE_CONFIG = {
  voice: 'Polly.Matthew' as const,
  language: 'en-US' as const,
};

interface TransferNode {
  type: 'transfer';
  say: string;
  holdMusic?: string;
}

interface MenuNode {
  type: 'menu';
  prompt: string;
  children: Record<string, IvrNode>;
}

type IvrNode = TransferNode | MenuNode;

const IVR_TREE: MenuNode = {
  type: 'menu',
  prompt:
    'Welcome to National Bank. ' +
    'Press 1 for card services. ' +
    'Press 2 for loans and mortgages. ' +
    'Press 3 for account services. ' +
    'Press 4 to report fraud or a lost card. ' +
    'Press 0 to speak with an operator.',
  children: {
    '1': {
      type: 'menu',
      prompt:
        'Card services. ' +
        'Press 1 to activate a card. ' +
        'Press 2 for card billing. ' +
        'Press 3 to report a stolen card. ' +
        'Press 0 to speak with a card services agent.',
      children: {
        '1': {
          type: 'transfer',
          say: 'I am transferring your call to card activation.',
        },
        '2': {
          type: 'menu',
          prompt:
            'Card billing. ' +
            'Press 1 for credit card billing. ' +
            'Press 2 for debit card billing. ' +
            'Press 3 for pending dues.',
          children: {
            '1': {
              type: 'transfer',
              say: 'I am transferring your call to credit card billing.',
            },
            '2': {
              type: 'transfer',
              say: 'I am transferring your call to debit card billing.',
            },
            '3': {
              type: 'transfer',
              say: 'I am transferring your call to the pending dues department.',
            },
          },
        },
        '3': {
          type: 'transfer',
          say: 'I am transferring your call to report a stolen card.',
        },
        '0': {
          type: 'transfer',
          say: 'I am transferring your call to a card services agent.',
        },
      },
    },
    '2': {
      type: 'menu',
      prompt:
        'Loans and mortgages. ' +
        'Press 1 to apply for a new loan. ' +
        'Press 2 to check existing loan status. ' +
        'Press 3 for mortgage inquiries. ' +
        'Press 0 to speak with a loan specialist.',
      children: {
        '1': {
          type: 'transfer',
          say: 'I am transferring your call to new loan applications.',
        },
        '2': {
          type: 'transfer',
          say: 'I am transferring your call to existing loan status.',
        },
        '3': {
          type: 'transfer',
          say: 'I am transferring your call to mortgage inquiries.',
        },
        '0': {
          type: 'transfer',
          say: 'I am transferring your call to a loan specialist.',
        },
      },
    },
    '3': {
      type: 'menu',
      prompt:
        'Account services. ' +
        'Press 1 to check your account balance. ' +
        'Press 2 to open a new account. ' +
        'Press 3 to close an account. ' +
        'Press 4 to request statements. ' +
        'Press 0 to speak with an account services agent.',
      children: {
        '1': {
          type: 'transfer',
          say: 'I am transferring your call to check your account balance.',
        },
        '2': {
          type: 'transfer',
          say: 'I am transferring your call to open a new account.',
        },
        '3': {
          type: 'transfer',
          say: 'I am transferring your call to close your account.',
        },
        '4': {
          type: 'transfer',
          say: 'I am transferring your call to request statements.',
        },
        '0': {
          type: 'transfer',
          say: 'I am transferring your call to an account services agent.',
        },
      },
    },
    '4': {
      type: 'transfer',
      say: 'This is an urgent matter. I am transferring your call to the fraud department immediately.',
      holdMusic: HOLD_MUSIC_ROCK,
    },
    '0': {
      type: 'transfer',
      say: 'I am transferring your call to an operator.',
    },
  },
};

function resolveNode(path: Array<string>): IvrNode | undefined {
  let current: IvrNode = IVR_TREE;
  for (const digit of path) {
    if (current.type !== 'menu') return undefined;
    const child: IvrNode | undefined = current.children[digit];
    if (!child) return undefined;
    current = child;
  }
  return current;
}

function renderMenu(res: Response, node: MenuNode, actionPath: string): void {
  const response = new twilio.twiml.VoiceResponse();
  response.say(VOICE_CONFIG, node.prompt);
  response.gather({
    input: ['dtmf'],
    numDigits: 1,
    timeout: GATHER_TIMEOUT,
    action: actionPath,
    method: 'POST',
  });
  response.say(VOICE_CONFIG, 'We did not receive your selection. Goodbye.');
  response.hangup();
  res.type('text/xml');
  res.send(response.toString());
}

function renderTransfer(res: Response, node: TransferNode): void {
  const holdMusic = node.holdMusic;
  const response = new twilio.twiml.VoiceResponse();

  // Transfer announcement
  response.say(VOICE_CONFIG, node.say);

  // Hold queue simulation (~60 seconds before connecting)
  response.say(
    VOICE_CONFIG,
    'Please hold while we connect you to the next available representative.'
  );
  if (holdMusic) {
    response.play(holdMusic);
  } else {
    response.pause({ length: 10 });
  }
  response.say(
    VOICE_CONFIG,
    'Your call is important to us. All representatives are currently assisting other customers. Please continue to hold.'
  );
  response.pause({ length: 10 });
  response.say(
    VOICE_CONFIG,
    'You are caller number 2 in the queue. Your estimated wait time is less than 1 minute.'
  );
  response.pause({ length: 10 });
  response.say(
    VOICE_CONFIG,
    'Thank you for your patience. A representative will be with you shortly.'
  );
  response.pause({ length: 5 });

  // Simulate a human representative picking up
  response.say(
    VOICE_CONFIG,
    'Hi, thank you for holding. This is Sarah from the customer service department. How can I help you today?'
  );
  // Wait for AI to ask "are you a real person?" and then respond
  response.pause({ length: 8 });
  response.say(
    VOICE_CONFIG,
    'Yes, I am a real person. I am here to assist you.'
  );
  // Stay on the line so the AI can complete the transfer flow
  response.pause({ length: 30 });
  res.type('text/xml');
  res.send(response.toString());
}

/**
 * Entry point: GET or POST /
 * Renders the root menu.
 */
router.get('/', (_req: Request, res: Response) => {
  renderMenu(res, IVR_TREE, '/voice/test-ivr/handle?path=');
});

router.post('/', (_req: Request, res: Response) => {
  renderMenu(res, IVR_TREE, '/voice/test-ivr/handle?path=');
});

/**
 * Generic handler: POST /handle?path=<comma-separated-digits>
 * Resolves the digit within the current menu, then either renders
 * the next menu or transfers the call.
 */
router.post('/handle', (req: Request, res: Response) => {
  const pathParam = (req.query.path as string) || '';
  const parentPath = pathParam ? pathParam.split(',') : [];
  const digit = req.body.Digits;

  const currentPath = [...parentPath, digit];
  const node = resolveNode(currentPath);

  if (!node) {
    const parentNode = resolveNode(parentPath);
    if (parentNode && parentNode.type === 'menu') {
      const response = new twilio.twiml.VoiceResponse();
      response.say(VOICE_CONFIG, 'Invalid selection. Please try again.');
      const actionPath = `/voice/test-ivr/handle?path=${parentPath.join(',')}`;
      renderMenu(res, parentNode, actionPath);
      return;
    }
    const response = new twilio.twiml.VoiceResponse();
    response.say(VOICE_CONFIG, 'An error occurred. Goodbye.');
    response.hangup();
    res.type('text/xml');
    res.send(response.toString());
    return;
  }

  if (node.type === 'transfer') {
    renderTransfer(res, node);
    return;
  }

  const actionPath = `/voice/test-ivr/handle?path=${currentPath.join(',')}`;
  renderMenu(res, node, actionPath);
});

/**
 * Minimal IVR that asks for an account number then transfers.
 * Used by the info-request live call test.
 *
 * Flow:
 *   GET/POST /voice/test-ivr/account-check
 *     → "Please say or enter your 8-digit account number."
 *     → Gather (speech + dtmf)
 *     → POST /voice/test-ivr/account-check/verify
 *       → If 8+ digits received: "Thank you. Transferring you now." + hold sim
 *       → Otherwise: "Sorry, I didn't get that." + retry (up to 2 times)
 */
const accountRetryCount: Record<string, number> = {};

function renderAccountPrompt(res: Response, actionUrl: string): void {
  const response = new twilio.twiml.VoiceResponse();
  response.say(
    VOICE_CONFIG,
    'Thank you for calling National Bank. To access your account, please say or enter your 8-digit account number.'
  );
  response.gather({
    input: ['speech', 'dtmf'] as any,
    timeout: 15,
    numDigits: 8,
    action: actionUrl,
    method: 'POST',
  });
  response.say(VOICE_CONFIG, 'We did not receive any input. Goodbye.');
  response.hangup();
  res.type('text/xml');
  res.send(response.toString());
}

router.get('/account-check', (_req: Request, res: Response) => {
  renderAccountPrompt(res, '/voice/test-ivr/account-check/verify');
});

router.post('/account-check', (_req: Request, res: Response) => {
  renderAccountPrompt(res, '/voice/test-ivr/account-check/verify');
});

router.post('/account-check/verify', (req: Request, res: Response) => {
  const callSid = req.body.CallSid || 'unknown';
  const speechResult = req.body.SpeechResult || '';
  const dtmfDigits = req.body.Digits || '';

  // Extract digits from speech or DTMF
  const input = dtmfDigits || speechResult.replace(/\D/g, '');

  const response = new twilio.twiml.VoiceResponse();

  if (input.length >= 8) {
    // Success — account number received
    delete accountRetryCount[callSid];
    response.say(
      VOICE_CONFIG,
      `Thank you. I found your account ending in ${input.slice(-4)}. Transferring you to a representative now.`
    );
    response.say(VOICE_CONFIG, 'Please hold while we connect you.');
    response.pause({ length: 3 });
    response.say(
      VOICE_CONFIG,
      'Hi, thank you for holding. This is Sarah. How can I help you today?'
    );
    response.pause({ length: 8 });
    response.say(
      VOICE_CONFIG,
      'Yes, I am a real person. I am here to assist you.'
    );
    response.pause({ length: 30 });
  } else {
    // Failed — retry up to 2 times
    const retries = accountRetryCount[callSid] || 0;
    if (retries >= 2) {
      delete accountRetryCount[callSid];
      response.say(
        VOICE_CONFIG,
        "I'm sorry, I was unable to verify your account. Let me connect you with a representative who can help."
      );
      response.pause({ length: 3 });
      response.say(
        VOICE_CONFIG,
        'Hi, this is Sarah. How can I help you today?'
      );
      response.pause({ length: 30 });
    } else {
      accountRetryCount[callSid] = retries + 1;
      response.say(
        VOICE_CONFIG,
        "I'm sorry, I didn't get a valid account number. Please try again."
      );
      response.gather({
        input: ['speech', 'dtmf'] as any,
        timeout: 15,
        numDigits: 8,
        action: '/voice/test-ivr/account-check/verify',
        method: 'POST',
      });
      response.say(VOICE_CONFIG, 'We did not receive any input. Goodbye.');
      response.hangup();
    }
  }

  res.type('text/xml');
  res.send(response.toString());
});

/**
 * Bridge endpoint: makes our AI navigator dial the account-check IVR.
 * Used by the live call test to connect two Twilio numbers on the same account.
 *
 * GET/POST /voice/test-ivr/bridge-to-account-check?transferNumber=...&callPurpose=...
 *   → <Dial> to TEST_USER_PHONE_NUMBER (which answers with account-check IVR)
 *   → The AI navigator's voice webhook is set as the action on <Dial>
 */
router.post('/bridge-to-account-check', (_req: Request, res: Response) => {
  const testNumber = process.env.TEST_USER_PHONE_NUMBER;
  if (!testNumber) {
    const r = new twilio.twiml.VoiceResponse();
    r.say(VOICE_CONFIG, 'Test number not configured.');
    r.hangup();
    res.type('text/xml');
    res.send(r.toString());
    return;
  }

  const response = new twilio.twiml.VoiceResponse();
  response.dial({ timeout: 20 }, testNumber);
  res.type('text/xml');
  res.send(response.toString());
});

export default router;
