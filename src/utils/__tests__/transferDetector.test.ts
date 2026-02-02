import { wantsTransfer, isIncompleteSpeech } from '../transferDetector';

describe('transferDetector', () => {
  describe('wantsTransfer', () => {
    it('should detect "transfer me" pattern', () => {
      expect(wantsTransfer('Can you transfer me to a representative?')).toBe(
        true
      );
      expect(wantsTransfer('Transfer me please')).toBe(true);
    });

    it('should detect "transfer the call" pattern', () => {
      expect(wantsTransfer('Please transfer the call')).toBe(true);
      expect(wantsTransfer('Transfer this call to someone')).toBe(true);
    });

    it('should detect "speak to a representative" pattern', () => {
      expect(wantsTransfer('I want to speak to a representative')).toBe(true);
      expect(wantsTransfer('Can I speak with a representative?')).toBe(true);
    });

    it('should detect "customer service" pattern', () => {
      expect(wantsTransfer('I need customer service')).toBe(true);
      expect(wantsTransfer('Connect me to customer service')).toBe(true);
    });

    it('should detect "human representative" pattern', () => {
      expect(wantsTransfer('I need a human representative')).toBe(true);
      expect(wantsTransfer('Can I talk to a real person?')).toBe(true);
    });

    it('should detect "agent" and "operator" patterns', () => {
      expect(wantsTransfer('I need to speak with an agent')).toBe(true);
      expect(wantsTransfer('Connect me to an operator')).toBe(true);
    });

    it('should detect transfer confirmation phrases', () => {
      expect(wantsTransfer("I'm transferring you now")).toBe(true);
      expect(wantsTransfer('You will be transferred')).toBe(true);
      expect(wantsTransfer("You'll be transferred to an agent")).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(wantsTransfer('TRANSFER ME')).toBe(true);
      expect(wantsTransfer('Transfer Me')).toBe(true);
      expect(wantsTransfer('transfer me')).toBe(true);
    });

    it('should return false for non-transfer phrases', () => {
      expect(wantsTransfer('Hello, how can I help you?')).toBe(false);
      expect(wantsTransfer('Press 1 for sales')).toBe(false);
      expect(wantsTransfer('Thank you for calling')).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(wantsTransfer(null)).toBe(false);
      expect(wantsTransfer(undefined)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(wantsTransfer('')).toBe(false);
    });

    it('should detect "talk to someone" pattern', () => {
      expect(wantsTransfer('I need to talk to someone')).toBe(true);
      expect(wantsTransfer('Can I talk to a person?')).toBe(true);
    });

    it('should detect "representative please" pattern', () => {
      expect(wantsTransfer('Representative please')).toBe(true);
      expect(wantsTransfer('I need a representative please')).toBe(true);
    });

    it('should detect transfer confirmation from system', () => {
      expect(wantsTransfer("I'm transferring you now")).toBe(true);
      expect(wantsTransfer('I will transfer you')).toBe(true);
      expect(wantsTransfer('I am transferring you')).toBe(true);
    });

    it('should detect variations of transfer phrases', () => {
      expect(wantsTransfer('Can you connect me to customer service?')).toBe(
        true
      );
      expect(wantsTransfer('I want to speak with an agent')).toBe(true);
      expect(wantsTransfer('Please transfer me to an operator')).toBe(true);
    });

    it('should not detect false positives', () => {
      expect(wantsTransfer('I do not want to transfer')).toBe(false);
      expect(wantsTransfer('Press 1 to transfer funds')).toBe(false);
      expect(wantsTransfer('Transfer your account balance')).toBe(false);
    });
  });

  describe('isIncompleteSpeech', () => {
    it('should detect incomplete speech without punctuation', () => {
      expect(isIncompleteSpeech('Hello how can')).toBe(true);
      expect(isIncompleteSpeech('Press 1 for')).toBe(true);
    });

    it('should return false for complete sentences with punctuation', () => {
      expect(isIncompleteSpeech('Hello, how can I help you?')).toBe(false);
      expect(isIncompleteSpeech('Press 1 for sales.')).toBe(false);
    });

    it('should return false for longer sentences without punctuation', () => {
      expect(
        isIncompleteSpeech(
          'This is a longer sentence that should not be considered incomplete'
        )
      ).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(isIncompleteSpeech(null)).toBe(false);
      expect(isIncompleteSpeech(undefined)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isIncompleteSpeech('')).toBe(false);
      expect(isIncompleteSpeech('   ')).toBe(false);
    });
  });
});
