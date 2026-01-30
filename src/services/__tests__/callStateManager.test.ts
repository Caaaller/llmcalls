import callStateManager, { CallState, ConversationEntry } from '../callStateManager';
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
      const updated = callStateManager.updateCallState(testCallSid, { menuLevel: 2 });
      
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
      callStateManager.addToHistory(testCallSid, { type: 'user', text: 'Hello' });
      callStateManager.addToHistory(testCallSid, { type: 'ai', text: 'Hi there' });
      callStateManager.addToHistory(testCallSid, { type: 'system', text: 'Menu detected' });
      
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
      callStateManager.addToHistory(testCallSid, { type: 'user', text: 'First message' });
      callStateManager.addToHistory(testCallSid, { type: 'ai', text: 'First response' });
      callStateManager.addToHistory(testCallSid, { type: 'user', text: 'Second message' });
      callStateManager.addToHistory(testCallSid, { type: 'ai', text: 'Second response' });
      
      const state = callStateManager.getCallState(testCallSid);
      expect(state.conversationHistory).toHaveLength(4);
      expect(state.conversationHistory[0].text).toBe('First message');
      expect(state.conversationHistory[1].text).toBe('First response');
      expect(state.conversationHistory[2].text).toBe('Second message');
      expect(state.conversationHistory[3].text).toBe('Second response');
    });

    it('should preserve timestamps in conversation history', () => {
      const before = new Date();
      callStateManager.addToHistory(testCallSid, { type: 'user', text: 'Test' });
      const after = new Date();
      
      const state = callStateManager.getCallState(testCallSid);
      const timestamp = state.conversationHistory[0].timestamp!;
      
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });
});

