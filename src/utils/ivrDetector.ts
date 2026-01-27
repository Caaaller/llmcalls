export interface MenuOption {
  digit: string;
  option: string;
}

/**
 * Extract DTMF options from IVR menu speech
 */
export function extractMenuOptions(speech: string): MenuOption[] {
  const options: MenuOption[] = [];

  // Pattern 1: "for X, press Y" or "to X, press Y" (description BEFORE press)
  const reversePattern = /(?:for|to)\s+([^,]+?),\s*press\s*(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = reversePattern.exec(speech)) !== null) {
    const option = match[1].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    const digit = match[2];
    if (digit && option && option.length > 0) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }

  // Pattern 2: "Press X, to Y" or "Press X, for Y"
  const pressPattern1 = /press\s*(\d+)\s*[,.]?\s*(?:to|for)\s+([^,]+?)(?=\s*[,.]?\s*(?:press|online|$))/gi;
  while ((match = pressPattern1.exec(speech)) !== null) {
    const digit = match[1];
    const option = match[2].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    if (digit && option && option.length > 0 && !options.some(opt => opt.digit === digit)) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }

  // Pattern 3: "Press X for Y" (without comma)
  const pressPattern2 = /press\s*(\d+)\s+for\s+([^,]+?)(?=\s*(?:press|and|or|,|\.|$))/gi;
  while ((match = pressPattern2.exec(speech)) !== null) {
    const digit = match[1];
    const option = match[2].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    if (digit && option && option.length > 0 && !options.some(opt => opt.digit === digit)) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }

  // Pattern 4: "X for Y" (without "press")
  const simplePattern = /(?:^|\s)(\d+)\s+for\s+([^,]+?)(?=\s*(?:press|and|or|,|\.|$))/gi;
  while ((match = simplePattern.exec(speech)) !== null) {
    const digit = match[1];
    const option = match[2].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    if (digit && option && option.length > 0 && !options.some(opt => opt.digit === digit)) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }

  return options;
}

/**
 * Check if IVR menu appears incomplete
 */
export function isIncompleteMenu(speech: string, menuOptions: MenuOption[]): boolean {
  if (!speech) return false;

  const pressMatches = speech.match(/press\s*\d/gi) || [];
  const forMatches = speech.match(/\d\s+for\s+[^,\.]+/gi) || [];
  const totalPatterns = pressMatches.length + forMatches.length;

  if (menuOptions.length === 0 && totalPatterns > 0) return true;
  if (menuOptions.length === 1 && totalPatterns > 1) return true;
  if (totalPatterns > menuOptions.length) return true;

  return false;
}

/**
 * Check if speech contains IVR menu patterns
 */
export function isIVRMenu(speech: string | null | undefined): boolean {
  if (!speech) return false;
  const lower = speech.toLowerCase();
  if (/(press|for|to)\s*\d/.test(lower)) return true;
  if (/\d\s+(for|to)\s+/.test(lower)) return true;
  if (/main menu|options are|following options/.test(lower)) return true;
  return false;
}