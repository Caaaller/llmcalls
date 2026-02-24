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

  const config = {
    transferNumber: process.env.TRANSFER_PHONE_NUMBER || '720-584-6358',
    userPhone: process.env.USER_PHONE || '720-584-6358',
    userEmail: process.env.USER_EMAIL || 'oliverullman@gmail.com',
  };

  try {
    console.log(
      '📋 Running prompt evaluation tests (single-step and multi-step in parallel)...\n'
    );
    const [report, multiStepReport] = await Promise.all([
      promptEvaluationService.runAllTests(config),
      promptEvaluationService.runAllMultiStepTests(config),
    ]);

    console.log('📋 Standard prompt evaluation results:\n');
    promptEvaluationService.printReport(report);
    console.log('\n\n📋 Multi-step loop detection results:\n');
    promptEvaluationService.printMultiStepReport(multiStepReport);

    if (report.failed > 0 || multiStepReport.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error running prompt evaluations:', error);
    process.exit(1);
  }
}

main();
