#!/usr/bin/env ts-node
/**
 * Prompt Evaluation CLI
 * Run prompt evaluations to test transfer, loop detection, and DTMF decisions
 *
 * Usage:
 *   npm run eval:prompts
 *   ts-node src/scripts/run-all-evals.ts
 */

import 'dotenv/config';
import promptEvaluationService from '../services/promptEvaluationService';

async function main() {
  console.log('🚀 Starting Prompt Evaluation Tests...\n');

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY environment variable is not set');
    console.error('   Please set it in your .env file or environment');
    process.exit(1);
  }

  try {
    // Run standard single-step tests
    console.log('📋 Running standard prompt evaluation tests...\n');
    const report = await promptEvaluationService.runAllTests({
      transferNumber: process.env.TRANSFER_PHONE_NUMBER || '720-584-6358',
      userPhone: process.env.USER_PHONE || '720-584-6358',
      userEmail: process.env.USER_EMAIL || 'oliverullman@gmail.com',
    });

    promptEvaluationService.printReport(report);

    // Run multi-step loop detection tests
    console.log('\n\n📋 Running multi-step loop detection tests...\n');
    const multiStepReport =
      await promptEvaluationService.runAllMultiStepTests({
        transferNumber: process.env.TRANSFER_PHONE_NUMBER || '720-584-6358',
        userPhone: process.env.USER_PHONE || '720-584-6358',
        userEmail: process.env.USER_EMAIL || 'oliverullman@gmail.com',
      });

    promptEvaluationService.printMultiStepReport(multiStepReport);

    // Exit with error if any tests failed
    if (report.failed > 0 || multiStepReport.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error running prompt evaluations:', error);
    process.exit(1);
  }
}

main();
