import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ITestCaseOverride extends Document {
  testCaseId: string;
  customInstructions: string;
  updatedAt: Date;
}

const TestCaseOverrideSchema = new Schema<ITestCaseOverride>(
  {
    testCaseId: { type: String, required: true, unique: true },
    customInstructions: { type: String, required: true },
  },
  { timestamps: true }
);

const TestCaseOverride: Model<ITestCaseOverride> =
  mongoose.model<ITestCaseOverride>('TestCaseOverride', TestCaseOverrideSchema);

export default TestCaseOverride;
