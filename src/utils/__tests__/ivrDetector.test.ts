import {
  extractMenuOptions,
  isIncompleteMenu,
  isIVRMenu,
  MenuOption,
} from '../ivrDetector';

describe('ivrDetector', () => {
  describe('extractMenuOptions', () => {
    it('should extract options from "for X, press Y" pattern', () => {
      const speech = 'For account issues, press 1. For billing, press 2.';
      const options = extractMenuOptions(speech);

      expect(options).toHaveLength(2);
      expect(options[0]).toEqual({ digit: '1', option: 'account issues' });
      expect(options[1]).toEqual({ digit: '2', option: 'billing' });
    });

    it('should extract options from "to X, press Y" pattern', () => {
      const speech =
        'To speak with a representative, press 0. To check your balance, press 1.';
      const options = extractMenuOptions(speech);

      expect(options).toHaveLength(2);
      expect(options[0]).toEqual({
        digit: '0',
        option: 'speak with a representative',
      });
      expect(options[1]).toEqual({ digit: '1', option: 'check your balance' });
    });

    it('should extract options from "Press X, to Y" pattern', () => {
      const speech =
        'Press 1, to receive a text message with a link to our customer service homepage. Press 2, to receive a text message with a link to the Amazon settlement help page.';
      const options = extractMenuOptions(speech);

      expect(options).toHaveLength(2);
      expect(options[0].digit).toBe('1');
      expect(options[0].option).toContain('receive a text message');
      expect(options[1].digit).toBe('2');
      expect(options[1].option).toContain('amazon settlement');
    });

    it('should extract options from "Press X, for Y" pattern', () => {
      const speech = 'Press 1 for sales, press 2 for support.';
      const options = extractMenuOptions(speech);

      expect(options).toHaveLength(2);
      expect(options[0]).toEqual({ digit: '1', option: 'sales' });
      expect(options[1]).toEqual({ digit: '2', option: 'support' });
    });

    it('should extract options from "Press X for Y" pattern (without comma)', () => {
      const speech =
        'Press 1 for account issues. Press 2 for billing questions.';
      const options = extractMenuOptions(speech);

      expect(options).toHaveLength(2);
      expect(options[0]).toEqual({ digit: '1', option: 'account issues' });
      expect(options[1]).toEqual({ digit: '2', option: 'billing questions' });
    });

    it('should extract options from "X for Y" pattern (without "press")', () => {
      const speech = '1 for sales, 2 for support, 3 for billing.';
      const options = extractMenuOptions(speech);

      expect(options).toHaveLength(3);
      expect(options[0]).toEqual({ digit: '1', option: 'sales' });
      expect(options[1]).toEqual({ digit: '2', option: 'support' });
      expect(options[2]).toEqual({ digit: '3', option: 'billing' });
    });

    it('should handle long descriptions with commas', () => {
      const speech =
        'Press 2, to receive a text message with a link to the Amazon settlement help page for questions about Amazon, legal settlements, where you can stay on the line for help with something else.';
      const options = extractMenuOptions(speech);

      expect(options).toHaveLength(1);
      expect(options[0].digit).toBe('2');
      expect(options[0].option).toContain('amazon settlement');
    });

    it('should handle multiple patterns in one speech', () => {
      const speech =
        'For account issues, press 1. Press 2 for billing. 3 for support.';
      const options = extractMenuOptions(speech);

      expect(options.length).toBeGreaterThanOrEqual(2);
      
      const option1 = options.find(opt => opt.digit === '1');
      expect(option1).toBeDefined();
      expect(option1!.option).toContain('account issues');
      
      const option2 = options.find(opt => opt.digit === '2');
      expect(option2).toBeDefined();
      expect(option2!.option).toContain('billing');
    });

    it('should not extract duplicate digits (keeps first occurrence)', () => {
      const speech = 'Press 1 for sales. Press 1 for support.';
      const options = extractMenuOptions(speech);

      const ones = options.filter(opt => opt.digit === '1');
      expect(ones.length).toBeLessThanOrEqual(1);
    });

    it('should handle options with periods and commas in description', () => {
      const speech =
        'Press 1, for orders, returns, and account issues. Press 2 for billing questions.';
      const options = extractMenuOptions(speech);

      expect(options.length).toBeGreaterThanOrEqual(2);
      expect(options[0].digit).toBe('1');
      expect(options[0].option).toContain('orders');
    });


    it('should handle options with "or" and "and" connectors', () => {
      const speech =
        'Press 1 for sales or support. Press 2 for billing and account issues.';
      const options = extractMenuOptions(speech);

      expect(options.length).toBeGreaterThanOrEqual(2);
      
      const option1 = options.find(opt => opt.digit === '1');
      expect(option1).toBeDefined();
      expect(option1!.option).toMatch(/(sales|support)/);
      
      const option2 = options.find(opt => opt.digit === '2');
      expect(option2).toBeDefined();
      expect(option2!.option).toContain('billing');
      expect(option2!.option).toContain('account issues');
    });

    it('should normalize option text to lowercase', () => {
      const speech = 'Press 1 for SALES. Press 2 for Support.';
      const options = extractMenuOptions(speech);

      expect(options[0].option).toBe('sales');
      expect(options[1].option).toBe('support');
    });

    it('should trim whitespace and punctuation from options', () => {
      const speech = 'Press 1, for  sales  . Press 2, for support.';
      const options = extractMenuOptions(speech);

      expect(options[0].option).toBe('sales');
      expect(options[1].option).toBe('support');
    });

    it('should return empty array for speech without menu patterns', () => {
      const speech = 'Hello, how can I help you today?';
      const options = extractMenuOptions(speech);

      expect(options).toHaveLength(0);
    });

    it('should handle empty string', () => {
      const options = extractMenuOptions('');
      expect(options).toHaveLength(0);
    });

    it('should extract options when "press" appears multiple times in description', () => {
      const speech =
        'Press 1 to press the button for help. Press 2 for support.';
      const options = extractMenuOptions(speech);

      expect(options.length).toBeGreaterThanOrEqual(2);
      expect(options[0].digit).toBe('1');
      expect(options[1].digit).toBe('2');
    });

    it('should not incorrectly associate descriptions with wrong digits in incomplete menus', () => {
      // Bug fix: "Press 1 for sales, press 2 for" should extract [{digit: "1", option: "sales"}]
      // and NOT incorrectly extract [{digit: "2", option: "sales"}] from "for sales, press 2"
      // The reverse pattern "for sales, press 2" should be skipped because "for sales" is
      // part of the forward pattern "Press 1 for sales"
      const speech = 'Press 1 for sales, press 2 for';
      const options = extractMenuOptions(speech);

      // Should only extract option 1 with correct association
      expect(options.length).toBeGreaterThanOrEqual(1);
      const option1 = options.find(opt => opt.digit === '1');
      expect(option1).toBeDefined();
      expect(option1!.option).toBe('sales');

      // Should NOT have option 2 with "sales" incorrectly associated
      // Option 2 should either not exist (incomplete) or have a different option text
      const option2 = options.find(opt => opt.digit === '2');
      if (option2) {
        expect(option2.option).not.toBe('sales');
      }
    });
  });

  describe('isIncompleteMenu', () => {
    it('should return true when menu options are empty but patterns exist', () => {
      const speech = 'Press 1 for sales, press 2 for support.';
      const menuOptions: MenuOption[] = [];

      expect(isIncompleteMenu(speech, menuOptions)).toBe(true);
    });

    it('should return true when only one option extracted but multiple patterns exist', () => {
      const speech =
        'Press 1 for sales, press 2 for support, press 3 for billing.';
      const menuOptions: MenuOption[] = [{ digit: '1', option: 'sales' }];

      expect(isIncompleteMenu(speech, menuOptions)).toBe(true);
    });

    it('should return false when all patterns are extracted', () => {
      const speech = 'Press 1 for sales, press 2 for support.';
      const menuOptions: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
      ];

      expect(isIncompleteMenu(speech, menuOptions)).toBe(false);
    });

    it('should return true when patterns exceed extracted options', () => {
      const speech =
        'Press 1 for sales, press 2 for support, press 3 for billing, press 4 for technical support.';
      const menuOptions: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
      ];

      expect(isIncompleteMenu(speech, menuOptions)).toBe(true);
    });

    it('should return false when extracted options match patterns exactly', () => {
      const speech =
        'Press 1 for sales. Press 2 for support. Press 3 for billing.';
      const menuOptions: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
        { digit: '3', option: 'billing' },
      ];

      expect(isIncompleteMenu(speech, menuOptions)).toBe(false);
    });

    it('should return false when no patterns exist', () => {
      const speech = 'Hello, how can I help you?';
      const menuOptions: MenuOption[] = [];

      expect(isIncompleteMenu(speech, menuOptions)).toBe(false);
    });

    it('should handle empty speech string', () => {
      const speech = '';
      const menuOptions: MenuOption[] = [];

      expect(isIncompleteMenu(speech, menuOptions)).toBe(false);
    });

    it('should detect incomplete menu with "for X" pattern', () => {
      const speech = '1 for sales, 2 for support, 3 for billing';
      const menuOptions: MenuOption[] = [{ digit: '1', option: 'sales' }];

      expect(isIncompleteMenu(speech, menuOptions)).toBe(true);
    });

    it('should handle menu with many options correctly', () => {
      const speech =
        'Press 1 for option one, press 2 for option two, press 3 for option three, press 4 for option four, press 5 for option five.';
      const menuOptions: MenuOption[] = [
        { digit: '1', option: 'option one' },
        { digit: '2', option: 'option two' },
        { digit: '3', option: 'option three' },
      ];

      expect(isIncompleteMenu(speech, menuOptions)).toBe(true);
    });
  });

  describe('isIVRMenu', () => {
    it('should return true for "press X" pattern', () => {
      expect(isIVRMenu('Press 1 for sales')).toBe(true);
      expect(isIVRMenu('press 2 for support')).toBe(true);
    });

    it('should return true for "for X" and "to X" patterns', () => {
      expect(isIVRMenu('For sales, press 1')).toBe(true);
      expect(isIVRMenu('To speak with a representative, press 0')).toBe(true);
    });

    it('should return true for menu keywords', () => {
      expect(isIVRMenu('Main menu options are available')).toBe(true);
      expect(isIVRMenu('The following options are available')).toBe(true);
    });

    it('should return false for regular conversation', () => {
      expect(isIVRMenu('Hello, how can I help you?')).toBe(false);
      expect(isIVRMenu('Thank you for calling')).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(isIVRMenu(null)).toBe(false);
      expect(isIVRMenu(undefined)).toBe(false);
    });
  });
});
