/**
 * Loop Detection Utility
 * Detects when IVR menus are repeating/looping
 */

class LoopDetector {
  constructor() {
    this.recentOptions = []; // Store recent menu options
    this.maxHistory = 10; // Keep last 10 options
  }

  /**
   * Add a menu option to history
   */
  addOption(option) {
    if (!option || !option.digit || !option.option) return;
    
    const optionKey = `${option.digit}-${option.option.toLowerCase()}`;
    this.recentOptions.push({
      digit: option.digit,
      option: option.option.toLowerCase(),
      key: optionKey,
      timestamp: Date.now()
    });

    // Keep only recent options
    if (this.recentOptions.length > this.maxHistory) {
      this.recentOptions.shift();
    }
  }

  /**
   * Check if current options contain a loop
   * A loop is defined as the exact repetition of an option description AND its corresponding key
   */
  detectLoop(currentOptions) {
    if (!currentOptions || currentOptions.length === 0) {
      return { isLoop: false };
    }

    // Check if any current option matches a recent option exactly
    for (const currentOption of currentOptions) {
      const currentKey = `${currentOption.digit}-${currentOption.option.toLowerCase()}`;
      
      // Look for exact match in recent history
      const matchIndex = this.recentOptions.findIndex(
        recent => recent.key === currentKey
      );

      if (matchIndex !== -1) {
        // Found a loop - same digit AND same option text
        return {
          isLoop: true,
          repeatedOption: currentOption,
          firstSeenAt: this.recentOptions[matchIndex].timestamp,
          message: `Loop detected: "${currentOption.option}" (Press ${currentOption.digit}) was repeated`
        };
      }
    }

    return { isLoop: false };
  }

  /**
   * Reset history (useful for new call or new menu level)
   */
  reset() {
    this.recentOptions = [];
  }

  /**
   * Check if speech contains a repeating pattern
   */
  static detectLoopInSpeech(speechResult, previousSpeech = '') {
    if (!speechResult || !previousSpeech) {
      return false;
    }

    // Extract "Press X for Y" patterns
    const pressPattern = /press\s*(\d+)\s+(?:for|to)\s+([^,\.]+)/gi;
    const currentMatches = [];
    const previousMatches = [];

    let match;
    while ((match = pressPattern.exec(speechResult)) !== null) {
      currentMatches.push({
        digit: match[1],
        option: match[2].trim().toLowerCase()
      });
    }

    while ((match = pressPattern.exec(previousSpeech)) !== null) {
      previousMatches.push({
        digit: match[1],
        option: match[2].trim().toLowerCase()
      });
    }

    // Check for exact repetition
    for (const current of currentMatches) {
      for (const previous of previousMatches) {
        if (current.digit === previous.digit && 
            current.option === previous.option) {
          return {
            isLoop: true,
            repeatedOption: current,
            message: `Loop detected in speech: "Press ${current.digit} for ${current.option}" was repeated`
          };
        }
      }
    }

    return { isLoop: false };
  }
}

module.exports = LoopDetector;

