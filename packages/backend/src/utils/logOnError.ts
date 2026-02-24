/**
 * Fire-and-forget promise with error logging.
 * Replaces the pattern: somePromise.catch(err => console.error('Error X:', err))
 */
export function logOnError(promise: Promise<unknown>, label: string): void {
  promise.catch(err => console.error(`${label}:`, err));
}
