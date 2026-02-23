# Logging Cleanup

## PR Description

- **`requestLogger` middleware** — Automatically logs every request and response in one line: method, path, status, duration, all query params, all body fields, and full response body (raw TwiML XML or JSON fields). Uses `console.error` for 5xx.
- **`logOnError` helper** — Replaces 22 repetitive `.catch(err => console.error(...))` blocks with `logOnError(promise, label)`.
- **Removed ~220 manual console statements** — Narration logs, variable dumps, startup banners, request body middleware, and redundant error logs that the middleware now handles.
- **No functional changes** — All business logic, error handling, and API responses are unchanged.

## Goal

Make logging automatic and implicit via middleware instead of manual console.log calls scattered through route handlers.

## What Changed

### Created `src/middleware/requestLogger.ts`

- Automatically logs every request/response in one line: method, path, status, duration, all query params, all body fields, and full response body
- Intercepts `res.json()` to capture JSON response fields, `res.send()` to capture raw TwiML XML
- Skips /health endpoint
- Replaces all manual "endpoint called", "speech received", "DTMF processed", "call status" logs

### Created `src/utils/logOnError.ts`

- `logOnError(promise, label)` for fire-and-forget error logging
- Replaces 22 repetitive `.catch(err => console.error(...))` blocks

### Deleted

- All step-by-step narration logs ("Extracting request data...", "Config created", etc.)
- Debug-level logs (variable dumps, prompt snippets, config echoing)
- Manual "endpoint called" / "speech received" / "DTMF processed" / "call status" / "transfer status" logs (now automatic)
- Manual error logs in route catch blocks (middleware shows 500 status)
- Verbose banners, request body middleware, health check logging, env var dumps
- Duplicate MongoDB connection logs in server.ts (database.ts already logs these)

### Kept

- Meaningful state transitions (IVR menu detected, AI decisions, transfer initiated, human confirmed, loop/termination detected)
- Service-level error catches (callHistoryService, aiDetectionService)
- Database lifecycle events
- Server startup/shutdown

## Files Created

- `src/middleware/requestLogger.ts`
- `src/utils/logOnError.ts`

## Files Modified

- `src/server.ts` — Added requestLogger middleware, removed duplicate MongoDB logs
- `src/routes/voiceRoutes.ts` — Removed 6 manual logs replaced by middleware, ~40 narration logs
- `src/routes/apiRoutes.ts` — Down to 1 console statement (auto-detected base URL)
- `src/routes/authRoutes.ts` — Removed 3 error logs (middleware shows 500 status)
- `src/services/database.ts` — Removed banners and setup instructions
- `src/services/callHistoryService.ts` — Removed tracking narration
- `src/services/aiService.ts` — Zero console output
- `src/services/twilioService.ts` — Removed verbose call creation logs
- `src/services/aiDTMFService.ts` — Removed AI analysis debug block
- `src/prompts/transfer-prompt.ts` — Removed debug logging
