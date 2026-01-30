/**
 * MongoDB Error Codes
 * Centralized mapping of MongoDB error codes to their meanings
 * Reference: https://github.com/mongodb/mongo/blob/master/src/mongo/base/error_codes.yml
 */

export const MONGO_ERROR_CODES = {
  // Duplicate Key Error
  11000: {
    name: 'DuplicateKeyError',
    description: 'Duplicate key error - document with this key already exists',
    isDuplicateKey: true,
  },
  
  // Write Concern Errors
  64: {
    name: 'WriteConcernError',
    description: 'Write concern error - write operation could not be confirmed',
    isDuplicateKey: false,
  },
  
  // Network Errors
  6: {
    name: 'HostUnreachable',
    description: 'Host unreachable - cannot connect to MongoDB server',
    isDuplicateKey: false,
  },
  
  7: {
    name: 'HostNotFound',
    description: 'Host not found - DNS resolution failed',
    isDuplicateKey: false,
  },
  
  // Authentication Errors
  18: {
    name: 'AuthenticationFailed',
    description: 'Authentication failed - invalid credentials',
    isDuplicateKey: false,
  },
  
  // Validation Errors
  121: {
    name: 'DocumentValidationFailure',
    description: 'Document validation failure - document does not match schema',
    isDuplicateKey: false,
  },
  
  // Index Errors
  85: {
    name: 'IndexOptionsConflict',
    description: 'Index options conflict - index already exists with different options',
    isDuplicateKey: false,
  },
  
  86: {
    name: 'IndexKeySpecsConflict',
    description: 'Index key specs conflict - index already exists with different key specs',
    isDuplicateKey: false,
  },
  
  // Namespace Errors
  26: {
    name: 'NamespaceNotFound',
    description: 'Namespace not found - database or collection does not exist',
    isDuplicateKey: false,
  },
  
  // Operation Errors
  50: {
    name: 'MaxTimeMSExpired',
    description: 'Max time MS expired - operation exceeded maximum execution time',
    isDuplicateKey: false,
  },
  
  51: {
    name: 'UnknownReplWriteConcern',
    description: 'Unknown replication write concern',
    isDuplicateKey: false,
  },
} as const;

export type MongoErrorCode = keyof typeof MONGO_ERROR_CODES;

/**
 * Get MongoDB error code information
 */
export function getMongoErrorInfo(code: number | undefined): {
  name: string;
  description: string;
  isDuplicateKey: boolean;
} | null {
  if (code === undefined) return null;
  
  const errorInfo = MONGO_ERROR_CODES[code as MongoErrorCode];
  if (!errorInfo) {
    return {
      name: 'UnknownError',
      description: `Unknown MongoDB error code: ${code}`,
      isDuplicateKey: false,
    };
  }
  
  return errorInfo;
}

/**
 * Check if error is a duplicate key error
 */
export function isDuplicateKeyError(code: number | undefined): boolean {
  const errorInfo = getMongoErrorInfo(code);
  return errorInfo?.isDuplicateKey ?? false;
}

