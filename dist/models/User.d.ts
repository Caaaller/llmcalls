/**
 * User Model
 * MongoDB schema for user authentication
 */
import { Document, Model } from 'mongoose';
export interface IUser extends Document {
    email: string;
    password: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    comparePassword(candidatePassword: string): Promise<boolean>;
    toJSON(): Omit<IUser, 'password'>;
}
declare const User: Model<IUser>;
export default User;
//# sourceMappingURL=User.d.ts.map