"use strict";
/**
 * Prompt Templates
 * Legacy file - kept for backward compatibility
 * All prompts now use transfer-prompt.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildConversationContext = void 0;
const buildConversationContext = (_scenario, speechResult, _isFirstCall, _conversationHistory = []) => {
    // This function is deprecated - transfer-only calls use aiService.buildTransferContext
    return `The automated system said: "${speechResult}".`;
};
exports.buildConversationContext = buildConversationContext;
exports.default = {
    buildConversationContext: exports.buildConversationContext
};
//# sourceMappingURL=templates.js.map