/**
 * Scenario Configuration
 * DEPRECATED: This file is kept for backward compatibility only
 * All calls now use transfer-only mode via config/transfer-config.js
 */

module.exports = {
  scenarios: {},
  
  /**
   * Get scenario by ID (deprecated)
   */
  getScenario(scenarioId) {
    console.warn(`⚠️  Scenario "${scenarioId}" is deprecated. Use transfer-only mode instead.`);
    return null;
  },
  
  /**
   * Get all scenario IDs (deprecated)
   */
  getAllScenarioIds() {
    return [];
  },
  
  /**
   * Get default scenario (deprecated)
   */
  getDefaultScenario() {
    return null;
  }
};
