import callStateManager, {
  CallState,
  ConversationEntry,
  createDefaultCallState,
} from '../callStateManager';
import { MenuOption } from '../../utils/ivrDetector';

describe('callStateManager', () => {
  const testCallSid = 'CA123456789';

  beforeEach(() => {
    callStateManager.clearCallState(testCallSid);
  });

  describe('getCallState', () => {
    it('should create a new call state if it does not exist', () => {
      const state = callStateManager.getCallState(testCallSid);
      const expectedDefaultState = createDefaultCallState(testCallSid);

      expect(state).toBeDefined();
      expect(state.callSid).toBe(expectedDefaultState.callSid);
      expect(state.menuLevel).toBe(expectedDefaultState.menuLevel);
      expect(state.lastMenuOptions).toEqual(
        expectedDefaultState.lastMenuOptions
      );
      expect(state.conversationHistory).toEqual(
        expectedDefaultState.conversationHistory
      );
      expect(state.partialSpeech).toBe(expectedDefaultState.partialSpeech);
      expect(state.scenarioId).toBe(expectedDefaultState.scenarioId);
      expect(state.createdAt).toBeInstanceOf(Date);
    });

    it('should return the same call state object for the same callSid', () => {
      const state1 = callStateManager.getCallState(testCallSid);
      callStateManager.updateCallState(testCallSid, { menuLevel: 2 });

      const state2 = callStateManager.getCallState(testCallSid);

      expect(state2.menuLevel).toBe(2);
      expect(state1).toBe(state2); // Same object reference
    });
  });

  describe('updateCallState', () => {
    it('should update call state properties', () => {
      const menuOptions: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
      ];

      const updated = callStateManager.updateCallState(testCallSid, {
        menuLevel: 1,
        lastMenuOptions: menuOptions,
      });

      expect(updated.menuLevel).toBe(1);
      expect(updated.lastMenuOptions).toEqual(menuOptions);
    });

    it('should merge updates without overwriting other properties', () => {
      const menuOptions: MenuOption[] = [
        { digit: '1', option: 'sales' },
        { digit: '2', option: 'support' },
      ];

      // First update: set menuLevel and lastMenuOptions
      callStateManager.updateCallState(testCallSid, {
        menuLevel: 1,
        lastMenuOptions: menuOptions,
      });

      // Second update: only update menuLevel, should preserve lastMenuOptions
      const updated = callStateManager.updateCallState(testCallSid, {
        menuLevel: 2,
      });

      expect(updated.menuLevel).toBe(2);
      expect(updated.lastMenuOptions).toEqual(menuOptions); // Should still be there
    });
  });

  describe('addToHistory', () => {
    it('should add conversation entry to history', () => {
      callStateManager.addToHistory(testCallSid, {
        type: 'user',
        text: 'Hello',
      });

      const state = callStateManager.getCallState(testCallSid);
      expect(state.conversationHistory).toHaveLength(1);
      expect(state.conversationHistory[0].type).toBe('user');
      expect(state.conversationHistory[0].text).toBe('Hello');
      expect(state.conversationHistory[0].timestamp).toBeInstanceOf(Date);
    });

    it('should add multiple entries', () => {
      callStateManager.addToHistory(testCallSid, {
        type: 'user',
        text: 'Hello',
      });
      callStateManager.addToHistory(testCallSid, {
        type: 'ai',
        text: 'Hi there',
      });
      callStateManager.addToHistory(testCallSid, {
        type: 'system',
        text: 'Menu detected',
      });

      const state = callStateManager.getCallState(testCallSid);
      expect(state.conversationHistory).toHaveLength(3);
    });

    it('should keep only last 20 entries', () => {
      for (let i = 0; i < 25; i++) {
        callStateManager.addToHistory(testCallSid, {
          type: 'user',
          text: `Message ${i}`,
        });
      }

      const state = callStateManager.getCallState(testCallSid);
      expect(state.conversationHistory).toHaveLength(20);
      expect(state.conversationHistory[0].text).toBe('Message 5');
      expect(state.conversationHistory[19].text).toBe('Message 24');
    });
  });

  describe('clearCallState', () => {
    it('should remove call state and reset to default', () => {
      // Set up some state first
      callStateManager.updateCallState(testCallSid, { menuLevel: 5 });
      callStateManager.addToHistory(testCallSid, {
        type: 'user',
        text: 'Test message',
      });

      // Verify state exists with data
      const stateBeforeClear = callStateManager.getCallState(testCallSid);
      expect(stateBeforeClear.menuLevel).toBe(5);
      expect(stateBeforeClear.conversationHistory).toHaveLength(1);

      // Clear the state
      callStateManager.clearCallState(testCallSid);

      // Verify it's reset to default
      const newState = callStateManager.getCallState(testCallSid);
      const expectedDefault = createDefaultCallState(testCallSid);
      expect(newState.menuLevel).toBe(expectedDefault.menuLevel);
      expect(newState.conversationHistory).toEqual(
        expectedDefault.conversationHistory
      );
    });
  });

  describe('conversation history across multiple turns', () => {
    it('should maintain conversation history across multiple turns', () => {
      callStateManager.addToHistory(testCallSid, {
        type: 'user',
        text: 'First message',
      });
      callStateManager.addToHistory(testCallSid, {
        type: 'ai',
        text: 'First response',
      });
      callStateManager.addToHistory(testCallSid, {
        type: 'user',
        text: 'Second message',
      });
      callStateManager.addToHistory(testCallSid, {
        type: 'ai',
        text: 'Second response',
      });

      const state = callStateManager.getCallState(testCallSid);
      expect(state.conversationHistory).toHaveLength(4);
      expect(state.conversationHistory[0].text).toBe('First message');
      expect(state.conversationHistory[1].text).toBe('First response');
      expect(state.conversationHistory[2].text).toBe('Second message');
      expect(state.conversationHistory[3].text).toBe('Second response');
    });

    it('should preserve timestamps in conversation history', () => {
      const before = new Date();
      callStateManager.addToHistory(testCallSid, {
        type: 'user',
        text: 'Test',
      });

      const state = callStateManager.getCallState(testCallSid);
      const timestamp = state.conversationHistory[0].timestamp!;

      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('should maintain conversation history with mixed entry types', () => {
      callStateManager.addToHistory(testCallSid, {
        type: 'user',
        text: 'Hello',
      });
      callStateManager.addToHistory(testCallSid, {
        type: 'ai',
        text: 'Hi there!',
      });
      callStateManager.addToHistory(testCallSid, {
        type: 'system',
        text: 'IVR menu detected',
      });
      callStateManager.addToHistory(testCallSid, {
        type: 'user',
        text: 'I need help',
      });

      const state = callStateManager.getCallState(testCallSid);
      expect(state.conversationHistory).toHaveLength(4);
      expect(state.conversationHistory[0].type).toBe('user');
      expect(state.conversationHistory[1].type).toBe('ai');
      expect(state.conversationHistory[2].type).toBe('system');
      expect(state.conversationHistory[3].type).toBe('user');
    });

    it('should maintain conversation history across multiple conversation turns', () => {
      // Simulate a multi-turn conversation
      const turns = [
        { type: 'user' as const, text: 'Hello' },
        { type: 'ai' as const, text: 'Hi, how can I help?' },
        { type: 'user' as const, text: 'I need to speak with someone' },
        { type: 'ai' as const, text: 'I can help with that' },
        { type: 'system' as const, text: 'Menu detected' },
        { type: 'user' as const, text: 'Press 1' },
        { type: 'ai' as const, text: 'Processing...' },
      ];

      turns.forEach(turn => {
        callStateManager.addToHistory(testCallSid, turn);
      });

      const state = callStateManager.getCallState(testCallSid);
      expect(state.conversationHistory).toHaveLength(7);
      expect(state.conversationHistory.map(e => e.type)).toEqual([
        'user',
        'ai',
        'user',
        'ai',
        'system',
        'user',
        'ai',
      ]);
    });

    it('should maintain conversation history order correctly', () => {
      for (let i = 0; i < 5; i++) {
        callStateManager.addToHistory(testCallSid, {
          type: i % 2 === 0 ? 'user' : 'ai',
          text: `Message ${i}`,
        });
      }

      const state = callStateManager.getCallState(testCallSid);
      expect(state.conversationHistory).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(state.conversationHistory[i].text).toBe(`Message ${i}`);
      }
    });

    it('should handle conversation history with empty text', () => {
      callStateManager.addToHistory(testCallSid, {
        type: 'system',
        text: '',
      });

      const state = callStateManager.getCallState(testCallSid);
      expect(state.conversationHistory).toHaveLength(1);
      expect(state.conversationHistory[0].text).toBe('');
    });
  });

  describe('awaitingCompleteMenu state', () => {
    it('should track awaitingCompleteMenu flag', () => {
      callStateManager.updateCallState(testCallSid, {
        awaitingCompleteMenu: true,
      });

      const state = callStateManager.getCallState(testCallSid);
      expect(state.awaitingCompleteMenu).toBe(true);
    });

    it('should track partialMenuOptions', () => {
      const partialOptions: MenuOption[] = [{ digit: '1', option: 'sales' }];

      callStateManager.updateCallState(testCallSid, {
        partialMenuOptions: partialOptions,
        awaitingCompleteMenu: true,
      });

      const state = callStateManager.getCallState(testCallSid);
      expect(state.partialMenuOptions).toEqual(partialOptions);
      expect(state.awaitingCompleteMenu).toBe(true);
    });

    it('should clear awaitingCompleteMenu when menu is complete', () => {
      callStateManager.updateCallState(testCallSid, {
        awaitingCompleteMenu: true,
        partialMenuOptions: [{ digit: '1', option: 'sales' }],
      });

      callStateManager.updateCallState(testCallSid, {
        awaitingCompleteMenu: false,
        partialMenuOptions: [],
      });

      const state = callStateManager.getCallState(testCallSid);
      expect(state.awaitingCompleteMenu).toBe(false);
      expect(state.partialMenuOptions).toEqual([]);
    });
  });
});
