import { MenuOption } from '../ivrDetector';

/**
 * Simple loop detector implementation for testing
 * Detects when the same menu options appear repeatedly
 */
class TestLoopDetector {
  private previousOptions: MenuOption[] = [];

  detectLoop(options: MenuOption[]): { isLoop: boolean; message?: string } {
    if (options.length === 0) {
      return { isLoop: false };
    }

    // Check if current options exactly match previous options
    if (this.previousOptions.length > 0 && this.previousOptions.length === options.length) {
      const isExactMatch = this.previousOptions.every((prev, index) => {
        const current = options[index];
        return prev.digit === current.digit && prev.option === current.option;
      });

      if (isExactMatch) {
        return {
          isLoop: true,
          message: 'Detected repeating menu options',
        };
      }
    }

    // Update previous options
    this.previousOptions = [...options];
    return { isLoop: false };
  }

  reset(): void {
    this.previousOptions = [];
  }
}

describe('loopDetector', () => {
  let detector: TestLoopDetector;

  beforeEach(() => {
    detector = new TestLoopDetector();
  });

  describe('detectLoop', () => {
    it('should detect exact repetition of menu options', () => {
      const options1: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
      ];
      
      const options2: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
      ];

      detector.detectLoop(options1);
      const result = detector.detectLoop(options2);

      expect(result.isLoop).toBe(true);
      expect(result.message).toContain('repeating');
    });

    it('should not detect loop when options are different', () => {
      const options1: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
      ];
      
      const options2: MenuOption[] = [
        { digit: '1', option: 'billing' },
        { digit: '2', option: 'support' },
      ];

      detector.detectLoop(options1);
      const result = detector.detectLoop(options2);

      expect(result.isLoop).toBe(false);
    });

    it('should not detect loop when same digit has different option', () => {
      const options1: MenuOption[] = [
        { digit: '1', option: 'pharmacy' },
      ];
      
      const options2: MenuOption[] = [
        { digit: '1', option: 'deli' },
      ];

      detector.detectLoop(options1);
      const result = detector.detectLoop(options2);

      expect(result.isLoop).toBe(false);
    });

    it('should not detect loop when number of options differs', () => {
      const options1: MenuOption[] = [
        { digit: '1', option: 'sales' },
      ];
      
      const options2: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
      ];

      detector.detectLoop(options1);
      const result = detector.detectLoop(options2);

      expect(result.isLoop).toBe(false);
    });

    it('should return false for empty options', () => {
      const result = detector.detectLoop([]);
      expect(result.isLoop).toBe(false);
    });

    it('should not detect loop on first call', () => {
      const options: MenuOption[] = [
        { digit: '1', option: 'sales' },
      ];

      const result = detector.detectLoop(options);
      expect(result.isLoop).toBe(false);
    });

    it('should detect loop after multiple different menus', () => {
      const menu1: MenuOption[] = [
        { digit: '1', option: 'sales' },
      ];
      const menu2: MenuOption[] = [
        { digit: '1', option: 'support' },
      ];
      const menu3: MenuOption[] = [
        { digit: '1', option: 'sales' },
      ];

      detector.detectLoop(menu1);
      detector.detectLoop(menu2);
      const result = detector.detectLoop(menu3);

      expect(result.isLoop).toBe(false); // Different from menu1
    });

    it('should detect loop when same menu appears again', () => {
      const menu1: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
      ];
      const menu2: MenuOption[] = [
        { digit: '1', option: 'billing' },
      ];
      const menu3: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
      ];

      detector.detectLoop(menu1);
      detector.detectLoop(menu2);
      const result = detector.detectLoop(menu3);

      expect(result.isLoop).toBe(true);
    });
  });

  describe('reset', () => {
    it('should clear previous options', () => {
      const options: MenuOption[] = [
        { digit: '1', option: 'sales' },
      ];

      detector.detectLoop(options);
      detector.reset();
      
      const result = detector.detectLoop(options);
      expect(result.isLoop).toBe(false);
    });
  });
});

