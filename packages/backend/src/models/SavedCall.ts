import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ISavedCall extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  toPhoneNumber: string;
  transferNumber: string;
  callPurpose: string;
  customInstructions?: string;
  createdAt: Date;
  updatedAt: Date;
}

const savedCallSchema = new Schema<ISavedCall>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    toPhoneNumber: {
      type: String,
      required: true,
    },
    transferNumber: {
      type: String,
      required: true,
    },
    callPurpose: {
      type: String,
      required: true,
    },
    customInstructions: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

savedCallSchema.index({ userId: 1, updatedAt: -1 });

const SavedCall: Model<ISavedCall> = mongoose.model<ISavedCall>(
  'SavedCall',
  savedCallSchema
);

export default SavedCall;
