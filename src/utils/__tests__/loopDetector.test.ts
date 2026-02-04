import { MenuOption } from '../ivrDetector';
import { createLoopDetector } from '../loopDetector';
import { LoopDetector } from '../../services/callStateManager';

describe('loopDetector', () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = createLoopDetector();
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
      const options1: MenuOption[] = [{ digit: '1', option: 'pharmacy' }];

      const options2: MenuOption[] = [{ digit: '1', option: 'deli' }];

      detector.detectLoop(options1);
      const result = detector.detectLoop(options2);

      expect(result.isLoop).toBe(false);
    });

    it('should not detect loop when number of options differs', () => {
      const options1: MenuOption[] = [{ digit: '1', option: 'sales' }];

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
      const options: MenuOption[] = [{ digit: '1', option: 'sales' }];

      const result = detector.detectLoop(options);
      expect(result.isLoop).toBe(false);
    });

    it('should detect loop when same menu appears again after different menus', () => {
      const menu1: MenuOption[] = [{ digit: '1', option: 'sales' }];
      const menu2: MenuOption[] = [{ digit: '1', option: 'support' }];
      const menu3: MenuOption[] = [{ digit: '1', option: 'sales' }];

      detector.detectLoop(menu1);
      detector.detectLoop(menu2);
      const result = detector.detectLoop(menu3);

      expect(result.isLoop).toBe(true); // menu3 is same as menu1, should detect loop
    });

    it('should detect loop when same menu appears again', () => {
      const menu1: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
      ];
      const menu2: MenuOption[] = [{ digit: '1', option: 'billing' }];
      const menu3: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
      ];

      detector.detectLoop(menu1);
      detector.detectLoop(menu2);
      const result = detector.detectLoop(menu3);

      expect(result.isLoop).toBe(true);
    });

    it('should detect loop with single option menu', () => {
      const menu: MenuOption[] = [{ digit: '0', option: 'operator' }];

      detector.detectLoop(menu);
      const result = detector.detectLoop(menu);

      expect(result.isLoop).toBe(true);
    });

    it('should detect loop with three or more options', () => {
      const menu: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
        { digit: '3', option: 'billing' },
        { digit: '4', option: 'other' },
      ];

      detector.detectLoop(menu);
      const result = detector.detectLoop(menu);

      expect(result.isLoop).toBe(true);
    });

    it('should detect loop after multiple different menus', () => {
      const menu1: MenuOption[] = [{ digit: '1', option: 'sales' }];
      const menu2: MenuOption[] = [{ digit: '1', option: 'support' }];
      const menu3: MenuOption[] = [{ digit: '1', option: 'billing' }];
      const menu4: MenuOption[] = [{ digit: '1', option: 'sales' }];

      detector.detectLoop(menu1);
      detector.detectLoop(menu2);
      detector.detectLoop(menu3);
      const result = detector.detectLoop(menu4);

      expect(result.isLoop).toBe(true);
    });

    it('should not detect loop when order differs', () => {
      const menu1: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
      ];
      const menu2: MenuOption[] = [
        { digit: '2', option: 'support' },
        { digit: '1', option: 'sales' },
      ];

      detector.detectLoop(menu1);
      const result = detector.detectLoop(menu2);

      expect(result.isLoop).toBe(false);
    });

    it('should provide loop detection message', () => {
      const menu: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
      ];

      detector.detectLoop(menu);
      const result = detector.detectLoop(menu);

      expect(result.isLoop).toBe(true);
      expect(result.message).toBeDefined();
      expect(result.message).toContain('repeating');
    });
  });

  describe('reset', () => {
    it('should clear previous options', () => {
      const options: MenuOption[] = [{ digit: '1', option: 'sales' }];

      detector.detectLoop(options);
      detector.reset();

      const result = detector.detectLoop(options);
      expect(result.isLoop).toBe(false);
    });
  });
});
