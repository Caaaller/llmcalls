/**
 * Comprehensive tests for transfer detection in various contexts
 */

import { wantsTransfer } from '../transferDetector';
import { TRANSFER_PATTERNS } from '../detectionPatterns';

describe('Transfer Detection in Various Contexts', () => {
  describe('Transfer Pattern Detection', () => {
    it('should detect all transfer patterns from constants', () => {
      TRANSFER_PATTERNS.forEach(pattern => {
        const testPhrase = `I need to ${pattern}`;
        expect(wantsTransfer(testPhrase)).toBe(true);
      });
    });

    it('should detect transfer in question format', () => {
      expect(wantsTransfer('Can you transfer me?')).toBe(true);
      expect(wantsTransfer('Could I speak to a representative?')).toBe(true);
      expect(wantsTransfer('Is it possible to talk to someone?')).toBe(true);
    });

    it('should detect transfer in statement format', () => {
      expect(wantsTransfer('I want to be transferred')).toBe(true);
      expect(wantsTransfer('Please transfer this call')).toBe(true);
      expect(wantsTransfer('I need customer service')).toBe(true);
    });

    it('should detect transfer in imperative format', () => {
      expect(wantsTransfer('Transfer me now')).toBe(true);
      expect(wantsTransfer('Connect me to an agent')).toBe(true);
      expect(wantsTransfer('Put me through to a representative')).toBe(false); // Not in patterns
    });

    it('should detect transfer in polite requests', () => {
      expect(wantsTransfer('Would you mind transferring me?')).toBe(true);
      expect(wantsTransfer('I would like to speak with a representative')).toBe(
        true
      );
      expect(wantsTransfer('Could I please talk to a real person?')).toBe(true);
    });
  });

  describe('Transfer Detection Edge Cases', () => {
    it('should detect transfer even with extra words', () => {
      expect(wantsTransfer('I really need to transfer me to someone')).toBe(
        true
      );
      expect(wantsTransfer('Can you please transfer the call for me?')).toBe(
        true
      );
      expect(wantsTransfer('I think I need to speak to a representative')).toBe(
        true
      );
    });

    it('should detect transfer in mixed case', () => {
      expect(wantsTransfer('TRANSFER ME')).toBe(true);
      expect(wantsTransfer('Transfer Me')).toBe(true);
      expect(wantsTransfer('tRaNsFeR tHe CaLl')).toBe(true);
    });

    it('should detect transfer with punctuation', () => {
      expect(wantsTransfer('Transfer me!')).toBe(true);
      expect(wantsTransfer('Transfer me.')).toBe(true);
      expect(wantsTransfer('Transfer me?')).toBe(true);
    });

    it('should not detect false positives', () => {
      expect(wantsTransfer('I do not want to transfer')).toBe(false);
      expect(wantsTransfer('Do not transfer my account')).toBe(false);
      expect(wantsTransfer('Transfer funds to my account')).toBe(false);
      expect(wantsTransfer('Press 1 to transfer money')).toBe(false);
    });

    it('should handle transfer in context of conversation', () => {
      expect(
        wantsTransfer(
          'Hello, I need to speak to a representative about my account'
        )
      ).toBe(true);
      expect(
        wantsTransfer(
          'I have been waiting and would like to transfer me to someone'
        )
      ).toBe(true);
      expect(
        wantsTransfer('This is taking too long, can you transfer the call?')
      ).toBe(true);
    });
  });

  describe('Transfer Confirmation Detection', () => {
    it('should detect system transfer confirmations', () => {
      expect(wantsTransfer("I'm transferring you now")).toBe(true);
      expect(wantsTransfer('I will transfer you')).toBe(true);
      expect(wantsTransfer('I am transferring you')).toBe(true);
      expect(wantsTransfer('You will be transferred')).toBe(true);
      expect(wantsTransfer("You'll be transferred")).toBe(true);
    });

    it('should detect transfer confirmations with details', () => {
      expect(
        wantsTransfer("I'm transferring you to a representative now")
      ).toBe(true);
      expect(wantsTransfer('You will be transferred to an agent shortly')).toBe(
        true
      );
      expect(wantsTransfer("You'll be transferred to customer service")).toBe(
        true
      );
    });
  });

  describe('Human Representative Detection', () => {
    it('should detect requests for human representative', () => {
      expect(wantsTransfer('I need a human representative')).toBe(true);
      expect(wantsTransfer('Can I talk to a real person?')).toBe(true);
      expect(wantsTransfer('I want to speak with a human')).toBe(false); // Not in patterns
    });

    it('should detect agent and operator requests', () => {
      expect(wantsTransfer('I need to speak with an agent')).toBe(true);
      expect(wantsTransfer('Connect me to an operator')).toBe(true);
      expect(wantsTransfer('I want to talk to an agent')).toBe(true);
    });
  });

  describe('Customer Service Detection', () => {
    it('should detect customer service requests', () => {
      expect(wantsTransfer('I need customer service')).toBe(true);
      expect(wantsTransfer('Connect me to customer service')).toBe(true);
      expect(wantsTransfer('Can I speak to customer service?')).toBe(true);
    });
  });

  describe('Null and Edge Cases', () => {
    it('should handle null input', () => {
      expect(wantsTransfer(null)).toBe(false);
    });

    it('should handle undefined input', () => {
      expect(wantsTransfer(undefined)).toBe(false);
    });

    it('should handle empty string', () => {
      expect(wantsTransfer('')).toBe(false);
    });

    it('should handle whitespace only', () => {
      expect(wantsTransfer('   ')).toBe(false);
      expect(wantsTransfer('\n\t')).toBe(false);
    });
  });
});



