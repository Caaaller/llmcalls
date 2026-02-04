import { MenuOption } from './ivrDetector';
import { LoopDetector } from '../services/callStateManager';

/**
 * Creates a loop detector instance that tracks seen menu options
 * to detect when the same menu appears repeatedly.
 *
 * @example
 * const detector = createLoopDetector();
 * detector.detectLoop([{ digit: '1', option: 'sales' }]); // { isLoop: false }
 * detector.detectLoop([{ digit: '1', option: 'sales' }]); // { isLoop: true, message: '...' }
 */
export function createLoopDetector(): LoopDetector {
  const seenOptions: string[] = [];

  return {
    detectLoop: (options: MenuOption[]): { isLoop: boolean; message?: string } => {
      if (options.length === 0) {
        return { isLoop: false };
      }

      const optionKey = options.map(o => `${o.digit}:${o.option}`).join('|');
      if (seenOptions.includes(optionKey)) {
        return {
          isLoop: true,
          message: 'Detected repeating menu options',
        };
      }
      seenOptions.push(optionKey);
      return { isLoop: false };
    },
    reset: (): void => {
      seenOptions.length = 0;
    },
  };
}

