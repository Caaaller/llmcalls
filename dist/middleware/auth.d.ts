/**
 * Authentication Middleware
 * Protects routes that require authentication
 */
import { Request, Response, NextFunction } from 'express';
import { IUser } from '../models/User';
declare const JWT_SECRET: string;
export interface AuthRequest extends Request {
    user?: IUser;
}
/**
 * Verify JWT token and attach user to request
 */
export declare const authenticate: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
/**
 * Generate JWT token
 */
export declare const generateToken: (userId: string) => string;
export { JWT_SECRET };
//# sourceMappingURL=auth.d.ts.map