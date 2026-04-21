import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ITestCaseResult {
  testCaseId: string;
  name: string;
  callSid: string;
  status:
    | 'passed'
    | 'failed'
    | 'business_closed'
    | 'remote_hangup'
    | 'skipped'
    | 'pending'
    | 'running';
  durationSeconds: number;
  error?: string;
  timedOut: boolean;
}

export interface ITestRun extends Document {
  runId: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'passed' | 'failed' | 'in_progress';
  totalTests: number;
  passedTests: number;
  failedTests: number;
  closedTests: number;
  testCases: ITestCaseResult[];
  createdAt: Date;
}

const TestCaseResultSchema = new Schema<ITestCaseResult>(
  {
    testCaseId: { type: String, required: true },
    name: { type: String, required: true },
    callSid: { type: String, default: '' },
    status: {
      type: String,
      enum: [
        'passed',
        'failed',
        'business_closed',
        'remote_hangup',
        'skipped',
        'pending',
        'running',
      ],
      required: true,
    },
    durationSeconds: { type: Number, default: 0 },
    error: { type: String },
    timedOut: { type: Boolean, default: false },
  },
  { _id: false }
);

const TestRunSchema = new Schema<ITestRun>(
  {
    runId: { type: String, required: true, unique: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date },
    status: {
      type: String,
      enum: ['passed', 'failed', 'in_progress'],
      required: true,
    },
    totalTests: { type: Number, required: true },
    passedTests: { type: Number, required: true },
    failedTests: { type: Number, required: true },
    closedTests: { type: Number, default: 0 },
    testCases: { type: [TestCaseResultSchema], required: true },
  },
  { timestamps: true }
);

TestRunSchema.index({ createdAt: 1 }, { expireAfterSeconds: 1209600 });

const TestRun: Model<ITestRun> = mongoose.model<ITestRun>(
  'TestRun',
  TestRunSchema
);

export default TestRun;
