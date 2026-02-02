import callStateManager, {
  CallState,
  ConversationEntry,
} from '../callStateManager';
import { MenuOption } from '../../utils/ivrDetector';

describe('callStateManager', () => {
  const testCallSid = 'CA123456789';

  beforeEach(() => {
    callStateManager.clearCallState(testCallSid);
  });

  afterEach(() => {
    callStateManager.clearCallState(testCallSid);
  });

  describe('getCallState', () => {
    it('should create new call state if not exists', () => {
      const state = callStateManager.getCallState(testCallSid);

      expect(state).toBeDefined();
      expect(state.callSid).toBe(testCallSid);
      expect(state.menuLevel).toBe(0);
      expect(state.lastMenuOptions).toEqual([]);
      expect(state.conversationHistory).toEqual([]);
    });

    it('should return existing call state', () => {
      const state1 = callStateManager.getCallState(testCallSid);
      state1.menuLevel = 2;

      const state2 = callStateManager.getCallState(testCallSid);

      expect(state2.menuLevel).toBe(2);
      expect(state1).toBe(state2);
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

    it('should merge updates with existing state', () => {
      callStateManager.updateCallState(testCallSid, { menuLevel: 1 });
      const updated = callStateManager.updateCallState(testCallSid, {
        menuLevel: 2,
      });

      expect(updated.menuLevel).toBe(2);
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
    it('should remove call state', () => {
      callStateManager.getCallState(testCallSid);
      callStateManager.clearCallState(testCallSid);

      const newState = callStateManager.getCallState(testCallSid);
      expect(newState.menuLevel).toBe(0);
      expect(newState.conversationHistory).toEqual([]);
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
      const after = new Date();

      const state = callStateManager.getCallState(testCallSid);
      const timestamp = state.conversationHistory[0].timestamp!;

      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
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
