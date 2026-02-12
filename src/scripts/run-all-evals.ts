#!/usr/bin/env ts-node
/**
 * Prompt Evaluation CLI
 * Run all prompt evaluations to test transfer, loop detection, and DTMF decisions
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
    const report = await promptEvaluationService.runAllTests({
      transferNumber: process.env.TRANSFER_PHONE_NUMBER || '720-584-6358',
      userPhone: process.env.USER_PHONE || '720-584-6358',
      userEmail: process.env.USER_EMAIL || 'oliverullman@gmail.com',
    });

    promptEvaluationService.printReport(report);
  } catch (error) {
    console.error('❌ Error running prompt evaluations:', error);
    process.exit(1);
  }
}

main();



