import {
  isVoicemailRecording,
  isClosedNoMenu,
  isDeadEnd,
  shouldTerminate,
} from '../terminationDetector';

describe('terminationDetector', () => {
  describe('isVoicemailRecording', () => {
    it('should detect "please leave a message after the beep"', () => {
      expect(
        isVoicemailRecording('Please leave a message after the beep')
      ).toBe(true);
    });

    it('should detect "please leave your message after the tone"', () => {
      expect(
        isVoicemailRecording('Please leave your message after the tone')
      ).toBe(true);
    });

    it('should detect "record your message"', () => {
      expect(isVoicemailRecording('Record your message now')).toBe(true);
    });

    it('should detect "at the tone"', () => {
      expect(isVoicemailRecording('Please speak at the tone')).toBe(true);
    });

    it('should detect "voicemail" keyword', () => {
      expect(isVoicemailRecording('You have reached voicemail')).toBe(true);
      expect(isVoicemailRecording('This is a voicemail box')).toBe(true);
    });

    it('should detect "leave a message"', () => {
      expect(isVoicemailRecording('Please leave a message')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(isVoicemailRecording('PLEASE LEAVE A MESSAGE')).toBe(true);
      expect(isVoicemailRecording('Voicemail')).toBe(true);
    });

    it('should return false for non-voicemail phrases', () => {
      expect(isVoicemailRecording('Hello, how can I help you?')).toBe(false);
      expect(isVoicemailRecording('Press 1 for sales')).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(isVoicemailRecording(null)).toBe(false);
      expect(isVoicemailRecording(undefined)).toBe(false);
    });
  });

  describe('isClosedNoMenu', () => {
    it('should detect "we are currently closed" without menu', () => {
      expect(
        isClosedNoMenu('We are currently closed. Please call back tomorrow.')
      ).toBe(true);
    });

    it('should detect "our office is currently closed" without menu', () => {
      expect(isClosedNoMenu('Our office is currently closed.')).toBe(true);
    });

    it('should detect "outside of our normal business hours"', () => {
      expect(
        isClosedNoMenu(
          'You have reached us outside of our normal business hours'
        )
      ).toBe(true);
    });

    it('should detect "our hours are" pattern', () => {
      expect(isClosedNoMenu('Our hours are Monday through Friday')).toBe(true);
    });

    it('should return false if closed message includes menu options', () => {
      expect(isClosedNoMenu('We are closed. Press 1 for more info')).toBe(
        false
      );
      expect(isClosedNoMenu('Closed. 1 for hours')).toBe(false);
    });

    it('should return false for regular business hours messages', () => {
      expect(isClosedNoMenu('We are open Monday through Friday')).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(isClosedNoMenu(null)).toBe(false);
      expect(isClosedNoMenu(undefined)).toBe(false);
    });
  });

  describe('isDeadEnd', () => {
    it('should return true when previous was closed and current is empty with sufficient silence', () => {
      const previous = 'We are currently closed.';
      const current = '';
      expect(isDeadEnd(current, previous, 5)).toBe(true);
      expect(isDeadEnd(current, previous, 10)).toBe(true);
    });

    it('should return false when silence duration is insufficient', () => {
      const previous = 'We are currently closed.';
      const current = '';
      expect(isDeadEnd(current, previous, 3)).toBe(false);
      expect(isDeadEnd(current, previous, 0)).toBe(false);
    });

    it('should return false when current speech is not empty', () => {
      const previous = 'We are currently closed.';
      const current = 'Press 1 for more information';
      expect(isDeadEnd(current, previous, 10)).toBe(false);
    });

    it('should return false when previous was not closed', () => {
      const previous = 'Hello, how can I help you?';
      const current = '';
      expect(isDeadEnd(current, previous, 10)).toBe(false);
    });

    it('should return false when previous is null', () => {
      expect(isDeadEnd('', null, 10)).toBe(false);
    });
  });

  describe('shouldTerminate', () => {
    it('should terminate for voicemail', () => {
      const result = shouldTerminate('Please leave a message after the beep');
      expect(result.shouldTerminate).toBe(true);
      expect(result.reason).toBe('voicemail');
      expect(result.message).toContain('Voicemail');
    });

    it('should terminate for closed with no menu', () => {
      const result = shouldTerminate(
        'We are currently closed. Please call back tomorrow.'
      );
      expect(result.shouldTerminate).toBe(true);
      expect(result.reason).toBe('closed_no_menu');
      expect(result.message).toContain('closed');
    });

    it('should terminate for dead end', () => {
      const previous = 'We are currently closed.';
      const result = shouldTerminate('', previous, 5);
      expect(result.shouldTerminate).toBe(true);
      expect(result.reason).toBe('dead_end');
      expect(result.message).toContain('dead end');
    });

    it('should not terminate for normal speech', () => {
      const result = shouldTerminate('Hello, how can I help you?');
      expect(result.shouldTerminate).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.message).toBeNull();
    });

    it('should prioritize voicemail over closed', () => {
      const result = shouldTerminate(
        'We are closed. Please leave a message after the beep'
      );
      expect(result.shouldTerminate).toBe(true);
      expect(result.reason).toBe('voicemail');
    });
  });
});
