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
const VOICE_CONFIG = {
  voice: 'Polly.Matthew' as const,
  language: 'en-US' as const,
};

interface TransferNode {
  type: 'transfer';
  say: string;
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

function getTransferTarget(): string {
  return (
    process.env.TRANSFER_PHONE_NUMBER ||
    process.env.TWILIO_PHONE_NUMBER ||
    '+10000000000'
  );
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
  const response = new twilio.twiml.VoiceResponse();
  response.say(VOICE_CONFIG, node.say);
  response.dial({ timeout: 30 }, getTransferTarget());
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

export default router;
