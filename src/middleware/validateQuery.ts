/**
 * Query Parameter Validation Middleware
 * Uses Zod to validate and type query parameters
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

/**
 * Extend Express Request to include validated query params
 */
export interface ValidatedRequest<T> extends Omit<Request, 'query'> {
  validatedQuery: T;
  query: Request['query']; // Keep original query for compatibility
}

/**
 * Middleware factory that validates query parameters using a Zod schema
 * @param schema - Zod schema for query parameters
 * @returns Express middleware that validates query params and adds typed values to req.validatedQuery
 */
export function validateQuery<T extends ZodSchema>(
  schema: T
): (
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Parse and validate query parameters
      const validated = schema.parse(req.query);
      
      // Add validated query params to request object
      (req as ValidatedRequest<z.infer<T>>).validatedQuery = validated;
      
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: error.issues.map((err: z.ZodIssue) => ({
            path: err.path.join('.'),
            message: err.message,
          })),
        });
        return;
      }
      
      res.status(500).json({
        success: false,
        error: 'Validation error',
      });
      return;
    }
  };
}

