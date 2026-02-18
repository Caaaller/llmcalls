# Business Logic Coupling Analysis

**Risk Level: HIGH** - Business logic scattered across frontend, routes, and utils instead of centralized in services.

---

## Critical Issues

### 1. Frontend-Only Validation

**File:** `frontend/src/App.js:102-110`

Frontend validates phone numbers, but backend only checks field existence. Direct API calls bypass validation.

**Impact:** Attackers can send malformed data to `/api/calls/initiate`

---

### 2. Business Logic in Utils

Core decision-making logic incorrectly placed in `utils/`:

- `transferDetector.js` - 15+ regex patterns for transfer detection
- `terminationDetector.js` - Call termination rules
- `ivrDetector.js` - IVR menu parsing

**Problem:** Utils should be helpers, not business rules. These should be services.

**Impact:** No single source of truth, hard to audit decisions

---

### 3. Missing Backend Validation

**File:** `routes/apiRoutes.js:156-230`

```javascript
if (!to) {
  // Only checks field exists
  return res.status(400).json({ error: 'Missing required field: to' });
}
// NO format validation, whitelist, rate limiting, or auth
```

**Missing:**

- Phone number format validation (E.164)
- Transfer number whitelist
- Rate limiting
- Authentication/authorization

---

### 4. In-Memory Call State

**File:** `services/callStateManager.js`

Call state stored in RAM only:

- Lost on server restart
- No multi-server support
- Not auditable

**Should:** Store in MongoDB with versioning

---

### 5. Fat Route Controllers

**File:** `routes/voiceRoutes.js` (464 lines)

Single route handles:

- Speech detection
- IVR navigation
- Transfer logic
- Human confirmation
- State management

**Should split into:**

- `voiceRoutes.js` - TwiML only
- `services/callProcessorService.js` - Speech analysis
- `services/transferService.js` - Transfer logic
- `services/ivrService.js` - IVR navigation

---

## What's Correct ✓

- Frontend never accesses MongoDB directly
- All database ops in backend services
- Clean REST API separation

---

## Recommendations

### Priority 1 (Critical)

1. **Move utils/ logic to services/**
   - `transferDetector.js` → `services/transferService.js`
   - `terminationDetector.js` → `services/terminationService.js`
   - `ivrDetector.js` → `services/ivrService.js`

2. **Add backend validation**
   - Phone number format (E.164)
   - Transfer number whitelist
   - Rate limiting by IP/user
   - Input sanitization

3. **Add authentication**
   - Require auth on `/api/calls/initiate`
   - Validate user permissions

### Priority 2 (High)

4. **Move call state to database**
   - Store in MongoDB instead of memory
   - Enable horizontal scaling

5. **Refactor voiceRoutes.js**
   - Extract business logic to services
   - Keep only TwiML generation in routes

---

## Summary Table

| Logic Type         | Current Location | Should Be | Status |
| ------------------ | ---------------- | --------- | ------ |
| Transfer detection | utils/           | services/ | ❌     |
| Termination logic  | utils/           | services/ | ❌     |
| IVR detection      | utils/           | services/ | ❌     |
| Input validation   | Frontend only    | Backend   | ❌     |
| Call state         | In-memory        | Database  | ❌     |
| Database access    | Backend only     | Backend   | ✅     |
