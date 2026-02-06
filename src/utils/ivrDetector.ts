export interface MenuOption {
  digit: string;
  option: string;
}

/**
 * Extract DTMF options from IVR menu speech
 *
 * Handles various patterns:
 * - "Press X for Y" (forward pattern)
 * - "For Y, press X" (reverse pattern)
 * - "X for Y" (simple pattern)
 *
 * Bug Fix: Reverse patterns are skipped if they're part of a forward pattern
 * to prevent incorrect digit-description associations in incomplete menus.
 *
 * Example bug scenario:
 * - Speech: "Press 1 for sales, press 2 for"
 * - Without fix: Pattern 1 (reverse) matches "for sales, press 2" backwards,
 *   incorrectly extracting [{digit: "2", option: "sales"}], while Pattern 2
 *   correctly captures [{digit: "1", option: "sales"}], creating duplicates.
 * - With fix: Reverse pattern detects "for sales" is part of "Press 1 for sales"
 *   and skips the match, preventing incorrect association.
 */
export function extractMenuOptions(speech: string): MenuOption[] {
  const options: MenuOption[] = [];

  // Pattern 1: "for X, press Y" or "to X, press Y" (description BEFORE press, with comma)
  // Skip if this is part of a forward "Press X for Y" pattern to avoid incorrect associations
  const reversePattern = /(?:for|to)\s+([^,]+?),\s*press\s*(\d+)/gi;
  let match: RegExpExecArray | null = null;
  while ((match = reversePattern.exec(speech)) !== null) {
    // Check if this match is part of a forward pattern (e.g., "Press 1 for sales, press 2")
    // by checking if "for/to" is immediately preceded by "press" + digit
    const matchStart = match.index;
    const textBeforeMatch = speech.substring(Math.max(0, matchStart - 15), matchStart);
    // If we see "press" + digit immediately before "for/to", skip it (it's part of a forward pattern)
    if (/press\s*\d\s*$/i.test(textBeforeMatch)) {
      continue;
    }

    const option = match[1].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    const digit = match[2];
    if (digit && option && option.length > 0) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }

  // Pattern 1b: "to X press Y" or "for X press Y" (description BEFORE press, without comma)
  // Skip if this is part of a forward "Press X for Y" pattern to avoid incorrect associations
  const reversePatternNoComma =
    /(?:for|to)\s+([^,]+?)\s+press\s*(\d+)(?=\s*(?:press|and|or|,|\.|$))/gi;
  while ((match = reversePatternNoComma.exec(speech)) !== null) {
    // Check if this match is part of a forward pattern
    const matchStart = match.index;
    const textBeforeMatch = speech.substring(Math.max(0, matchStart - 15), matchStart);
    // If we see "press" + digit immediately before "for/to", skip it (it's part of a forward pattern)
    if (/press\s*\d\s*$/i.test(textBeforeMatch)) {
      continue;
    }

    const option = match[1].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    const digit = match[2];
    if (
      digit &&
      option &&
      option.length > 0 &&
      !options.some(opt => opt.digit === digit)
    ) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }

  // Pattern 2: "Press X, to Y" or "Press X, for Y" - improved to handle long descriptions
  // Use a simpler approach: find "press X" and capture everything after "to/for" until next "press" or end
  const pressMatches = [
    ...speech.matchAll(/press\s*(\d+)\s*[,.]?\s*(?:to|for)\s+/gi),
  ];
  for (const pressMatch of pressMatches) {
    if (pressMatch.index === undefined) continue;

    const digit = pressMatch[1];
    const matchStart = pressMatch.index + pressMatch[0].length;
    const textAfterPress = speech.substring(matchStart);

    // Find the next "press X" pattern
    const nextPressMatch = textAfterPress.match(/press\s*\d/i);
    let option: string;

    if (nextPressMatch && nextPressMatch.index !== undefined) {
      // Capture text up to the next "press"
      option = textAfterPress.substring(0, nextPressMatch.index).trim();
    } else {
      // No next "press" - capture all remaining text
      option = textAfterPress.trim();
    }

    // Clean up the option text
    option = option
      .replace(/^[,.\s]+|[,.\s]+$/g, '')
      .replace(/[,.]+\s*$/, '')
      .trim();

    if (
      digit &&
      option &&
      option.length > 0 &&
      !options.some(opt => opt.digit === digit)
    ) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }

  // Pattern 3: "Press X for Y" (without comma)
  const pressPattern2 =
    /press\s*(\d+)\s+for\s+([^,]+?)(?=\s*(?:press|and|or|,|\.|$))/gi;
  while ((match = pressPattern2.exec(speech)) !== null) {
    const digit = match[1];
    const option = match[2].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    if (
      digit &&
      option &&
      option.length > 0 &&
      !options.some(opt => opt.digit === digit)
    ) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }

  // Pattern 4: "X for Y" (without "press")
  const simplePattern =
    /(?:^|\s)(\d+)\s+for\s+([^,]+?)(?=\s*(?:press|and|or|,|\.|$))/gi;
  while ((match = simplePattern.exec(speech)) !== null) {
    const digit = match[1];
    const option = match[2].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    if (
      digit &&
      option &&
      option.length > 0 &&
      !options.some(opt => opt.digit === digit)
    ) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }

  return options;
}

/**
 * Check if IVR menu appears incomplete by comparing the number of menu patterns
 * in the speech with the number of successfully extracted options.
 *
 * @example
 * // Incomplete: speech has 2 patterns but only 1 option extracted
 * isIncompleteMenu('Press 1 for sales, press 2 for support', [{ digit: '1', option: 'sales' }])
 * // returns true
 *
 * @example
 * // Complete: all patterns were extracted
 * isIncompleteMenu('Press 1 for sales, press 2 for support', [
 *   { digit: '1', option: 'sales' },
 *   { digit: '2', option: 'support' }
 * ])
 * // returns false
 */
export function isIncompleteMenu(
  speech: string,
  menuOptions: MenuOption[]
): boolean {
  if (!speech) return false;

  const pressMatches = speech.match(/press\s*\d/gi) || [];
  const forMatches = speech.match(/\d\s+for\s+[^,.]+/gi) || [];
  const totalPatterns = pressMatches.length + forMatches.length;

  if (menuOptions.length === 0 && totalPatterns > 0) return true;
  if (menuOptions.length === 1 && totalPatterns > 1) return true;
  if (totalPatterns > menuOptions.length) return true;

  return false;
}

/**
 * Check if speech contains IVR menu patterns such as "press X", "for X", "to X",
 * or common menu keywords.
 *
 * @example
 * isIVRMenu('Press 1 for sales') // returns true
 * isIVRMenu('For account issues, press 2') // returns true
 * isIVRMenu('Main menu options are available') // returns true
 * isIVRMenu('Hello, how can I help you?') // returns false
 */
export function isIVRMenu(speech: string | null | undefined): boolean {
  if (!speech) return false;
  const lower = speech.toLowerCase();
  if (/(press|for|to)\s*\d/.test(lower)) return true;
  if (/\d\s+(for|to)\s+/.test(lower)) return true;
  if (/main menu|options are|following options/.test(lower)) return true;
  return false;
}
