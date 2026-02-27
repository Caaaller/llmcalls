/**
 * Live Call Test Cases
 * Pre-defined test scenarios for automated evaluation
 */

import { LiveCallTestCase } from './liveCallEvalService';

export const DEFAULT_TEST_CASES: LiveCallTestCase[] = [
  {
    id: 'amazon-cs',
    name: 'Amazon Customer Service',
    description: 'Call Amazon customer service and navigate to representative',
    phoneNumber: '+18882804331',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDTMFPresses: 5,
      maxDurationSeconds: 180,
    },
  },
  {
    id: 'walmart-cs',
    name: 'Walmart Customer Service',
    description: 'Call Walmart customer service and navigate to representative',
    phoneNumber: '+18009256278',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDTMFPresses: 5,
      maxDurationSeconds: 180,
    },
  },
  {
    id: 'target-cs',
    name: 'Target Guest Services',
    description: 'Call Target guest services and navigate to representative',
    phoneNumber: '+18004400680',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDTMFPresses: 5,
      maxDurationSeconds: 180,
    },
  },
  {
    id: 'bestbuy-cs',
    name: 'Best Buy Customer Service',
    description:
      'Call Best Buy customer service and navigate to representative',
    phoneNumber: '+18882378289',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDTMFPresses: 5,
      maxDurationSeconds: 180,
    },
  },
  {
    id: 'bankofamerica-cs',
    name: 'Bank of America Customer Service',
    description: 'Call Bank of America and navigate to representative',
    phoneNumber: '+18004321000',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDTMFPresses: 5,
      maxDurationSeconds: 180,
    },
  },
  {
    id: 'wellsfargo-cs',
    name: 'Wells Fargo Customer Service',
    description: 'Call Wells Fargo and navigate to representative',
    phoneNumber: '+18008693557',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDTMFPresses: 5,
      maxDurationSeconds: 180,
    },
  },
  {
    id: 'att-cs',
    name: 'AT&T Customer Service',
    description: 'Call AT&T customer service and navigate to representative',
    phoneNumber: '+18003310500',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDTMFPresses: 5,
      maxDurationSeconds: 180,
    },
  },
  {
    id: 'verizon-cs',
    name: 'Verizon Customer Service',
    description: 'Call Verizon customer service and navigate to representative',
    phoneNumber: '+18009220204',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      shouldReachHuman: true,
      maxDTMFPresses: 5,
      maxDurationSeconds: 180,
    },
  },
];

export const QUICK_TEST_CASES: LiveCallTestCase[] = [
  {
    id: 'quick-amazon',
    name: 'Quick Test - Amazon',
    description: 'Quick test with Amazon customer service',
    phoneNumber: '+18882804331',
    callPurpose: 'speak with a representative',
    expectedOutcome: {
      maxDTMFPresses: 6,
      maxDurationSeconds: 180,
    },
  },
];
