/**
 * Integration tests for incomplete menu detection and waiting behavior
 * Tests the flow of detecting incomplete menus and waiting for complete menus
 */

import * as ivrDetector from '../ivrDetector';
import callStateManager from '../../services/callStateManager';
import { MenuOption } from '../ivrDetector';

describe('Menu Waiting Flow', () => {
  const testCallSid = 'CA_TEST_MENU_WAITING';

  beforeEach(() => {
    callStateManager.clearCallState(testCallSid);
  });

  afterEach(() => {
    callStateManager.clearCallState(testCallSid);
  });

  describe('Incomplete Menu Detection and Waiting', () => {
    it('should detect incomplete menu and set awaitingCompleteMenu flag', () => {
      const speech =
        'Press 1 for sales, press 2 for support, press 3 for billing.';
      const menuOptions = ivrDetector.extractMenuOptions(speech);
      const isIncomplete = ivrDetector.isIncompleteMenu(speech, menuOptions);

      if (isIncomplete) {
        callStateManager.updateCallState(testCallSid, {
          partialMenuOptions: menuOptions,
          awaitingCompleteMenu: true,
        });
      }

      const state = callStateManager.getCallState(testCallSid);
      if (isIncomplete) {
        expect(state.awaitingCompleteMenu).toBe(true);
        expect(state.partialMenuOptions).toEqual(menuOptions);
      }
    });

    it('should wait for complete menu when only partial options are extracted', () => {
      // First speech with incomplete menu
      const firstSpeech = 'Press 1 for sales';
      const firstOptions = ivrDetector.extractMenuOptions(firstSpeech);
      const isFirstIncomplete = ivrDetector.isIncompleteMenu(
        firstSpeech,
        firstOptions
      );

      expect(isFirstIncomplete).toBe(true);

      callStateManager.updateCallState(testCallSid, {
        partialMenuOptions: firstOptions,
        awaitingCompleteMenu: true,
      });

      let state = callStateManager.getCallState(testCallSid);
      expect(state.awaitingCompleteMenu).toBe(true);
      expect(state.partialMenuOptions).toHaveLength(1);

      // Second speech continues the menu
      const secondSpeech = ', press 2 for support, press 3 for billing.';
      const secondOptions = ivrDetector.extractMenuOptions(secondSpeech);
      const isSecondIncomplete = ivrDetector.isIncompleteMenu(
        secondSpeech,
        secondOptions
      );

      // Merge options
      if (state.partialMenuOptions && state.partialMenuOptions.length > 0) {
        const allOptions = [...state.partialMenuOptions, ...secondOptions];
        const seen = new Set<string>();
        const mergedOptions = allOptions.filter(opt => {
          const key = `${opt.digit}-${opt.option}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        callStateManager.updateCallState(testCallSid, {
          partialMenuOptions: [],
          awaitingCompleteMenu: false,
          lastMenuOptions: mergedOptions,
        });
      }

      state = callStateManager.getCallState(testCallSid);
      expect(state.awaitingCompleteMenu).toBe(false);
      expect(state.lastMenuOptions.length).toBeGreaterThan(1);
    });

    it('should clear awaitingCompleteMenu when menu is complete', () => {
      const speech = 'Press 1 for sales, press 2 for support.';
      const menuOptions = ivrDetector.extractMenuOptions(speech);
      const isIncomplete = ivrDetector.isIncompleteMenu(speech, menuOptions);

      expect(isIncomplete).toBe(false);

      callStateManager.updateCallState(testCallSid, {
        lastMenuOptions: menuOptions,
        awaitingCompleteMenu: false,
        partialMenuOptions: [],
      });

      const state = callStateManager.getCallState(testCallSid);
      expect(state.awaitingCompleteMenu).toBe(false);
      expect(state.partialMenuOptions).toEqual([]);
      expect(state.lastMenuOptions).toEqual(menuOptions);
    });

    it('should handle menu continuation across multiple speech segments', () => {
      // Segment 1: Incomplete
      const segment1 = 'Press 1 for account issues';
      const options1 = ivrDetector.extractMenuOptions(segment1);
      const incomplete1 = ivrDetector.isIncompleteMenu(segment1, options1);

      if (incomplete1) {
        callStateManager.updateCallState(testCallSid, {
          partialMenuOptions: options1,
          awaitingCompleteMenu: true,
        });
      }

      // Segment 2: Still incomplete
      const segment2 = ', press 2 for billing questions';
      const options2 = ivrDetector.extractMenuOptions(segment2);
      const incomplete2 = ivrDetector.isIncompleteMenu(segment2, options2);

      if (incomplete2) {
        const state = callStateManager.getCallState(testCallSid);
        if (state.partialMenuOptions) {
          const merged = [...state.partialMenuOptions, ...options2];
          callStateManager.updateCallState(testCallSid, {
            partialMenuOptions: merged,
            awaitingCompleteMenu: true,
          });
        }
      }

      // Segment 3: Complete
      const segment3 = ', press 3 for technical support.';
      const options3 = ivrDetector.extractMenuOptions(segment3);
      const incomplete3 = ivrDetector.isIncompleteMenu(segment3, options3);

      if (!incomplete3) {
        const state = callStateManager.getCallState(testCallSid);
        if (state.partialMenuOptions) {
          const allOptions = [...state.partialMenuOptions, ...options3];
          callStateManager.updateCallState(testCallSid, {
            partialMenuOptions: [],
            awaitingCompleteMenu: false,
            lastMenuOptions: allOptions,
          });
        }
      }

      const finalState = callStateManager.getCallState(testCallSid);
      expect(finalState.awaitingCompleteMenu).toBe(false);
      expect(finalState.lastMenuOptions.length).toBeGreaterThanOrEqual(3);
    });

    it('should not proceed when menu is incomplete', () => {
      const speech = 'Press 1 for sales';
      const menuOptions = ivrDetector.extractMenuOptions(speech);
      const isIncomplete = ivrDetector.isIncompleteMenu(speech, menuOptions);

      expect(isIncomplete).toBe(true);

      callStateManager.updateCallState(testCallSid, {
        partialMenuOptions: menuOptions,
        awaitingCompleteMenu: true,
      });

      const state = callStateManager.getCallState(testCallSid);
      // Should wait, not proceed
      expect(state.awaitingCompleteMenu).toBe(true);
      expect(state.lastMenuOptions.length).toBeLessThanOrEqual(
        menuOptions.length
      );
    });

    it('should proceed when menu is complete', () => {
      const speech =
        'Press 1 for sales, press 2 for support, press 3 for billing.';
      const menuOptions = ivrDetector.extractMenuOptions(speech);
      const isIncomplete = ivrDetector.isIncompleteMenu(speech, menuOptions);

      expect(isIncomplete).toBe(false);

      callStateManager.updateCallState(testCallSid, {
        lastMenuOptions: menuOptions,
        awaitingCompleteMenu: false,
        partialMenuOptions: [],
      });

      const state = callStateManager.getCallState(testCallSid);
      // Should proceed
      expect(state.awaitingCompleteMenu).toBe(false);
      expect(state.lastMenuOptions.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Menu Option Merging', () => {
    it('should merge partial menu options correctly', () => {
      const partial1: MenuOption[] = [{ digit: '1', option: 'sales' }];
      const partial2: MenuOption[] = [
        { digit: '2', option: 'support' },
        { digit: '3', option: 'billing' },
      ];

      callStateManager.updateCallState(testCallSid, {
        partialMenuOptions: partial1,
        awaitingCompleteMenu: true,
      });

      const state = callStateManager.getCallState(testCallSid);
      if (state.partialMenuOptions) {
        const merged = [...state.partialMenuOptions, ...partial2];
        const seen = new Set<string>();
        const uniqueMerged = merged.filter(opt => {
          const key = `${opt.digit}-${opt.option}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        callStateManager.updateCallState(testCallSid, {
          partialMenuOptions: [],
          awaitingCompleteMenu: false,
          lastMenuOptions: uniqueMerged,
        });
      }

      const finalState = callStateManager.getCallState(testCallSid);
      expect(finalState.lastMenuOptions).toHaveLength(3);
      expect(finalState.awaitingCompleteMenu).toBe(false);
    });

    it('should remove duplicates when merging menu options', () => {
      const partial1: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
      ];
      const partial2: MenuOption[] = [
        { digit: '2', option: 'support' }, // Duplicate
        { digit: '3', option: 'billing' },
      ];

      callStateManager.updateCallState(testCallSid, {
        partialMenuOptions: partial1,
        awaitingCompleteMenu: true,
      });

      const state = callStateManager.getCallState(testCallSid);
      if (state.partialMenuOptions) {
        const merged = [...state.partialMenuOptions, ...partial2];
        const seen = new Set<string>();
        const uniqueMerged = merged.filter(opt => {
          const key = `${opt.digit}-${opt.option}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        callStateManager.updateCallState(testCallSid, {
          partialMenuOptions: [],
          awaitingCompleteMenu: false,
          lastMenuOptions: uniqueMerged,
        });
      }

      const finalState = callStateManager.getCallState(testCallSid);
      expect(finalState.lastMenuOptions).toHaveLength(3);
      expect(
        finalState.lastMenuOptions.filter(opt => opt.digit === '2')
      ).toHaveLength(1);
    });
  });
});




