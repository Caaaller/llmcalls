## MANDATORY: Import Context-Specific Rules

Before starting relevant tasks, READ the appropriate rule file:

- **Frontend**: ~/.claude/frontend-conventions.md

---

## MANDATORY: Spec driven development

When starting any changes, create a file in the ~/plans folder. It should be short:

Small changes: < 50 lines
Medium changes: ~100 lines
Large changes: 150-300 (at max)

In these plans you should be as coincise as possible. Sometimes it is necessary to provide code examples, but don't overuse that.

These plan files should be the source of truth as you are making changes, they should get updated over time as they will be reviewed during pull requests

## DRY and duplicated code

THIS IS EXTREMELY IMPORTANT. Avoid repeating code. Create shared functions and utilities. Route handlers can be extracted into functions if they need to be reused for evals or testing.

# Writing Guidelines

When adding new guidelines to this file:

**Style:**

- Keep them SHORT and actionable (1-3 lines preferred)
- Lead with the action/rule, not explanation
- Use imperative voice ("Do X", not "You should do X")
- Only include examples if absolutely necessary for clarity

**Structure:**

- Title: Use "MANDATORY:" prefix only for critical, non-negotiable rules
- Content: State what to do, not why (assume I understand context)
- Format: Use simple sentences, avoid numbered lists unless showing a sequence
- Length: If you need >5 lines, the rule is probably too complex - simplify or split

**Examples of good guidelines:**

- "When modifying test files, MUST run the test and verify it passes before reporting success."
- "Use `Array<TheType>` not `TheType[]`"
- "NEVER add comments unless explicitly asked."

**Examples of bad guidelines:**

- Long explanations of why a rule exists
- Multiple bullet points listing edge cases
- Overly detailed procedures with numbered steps
- Examples showing both good and bad approaches (just state the rule)

**When to add:**

- Recurring mistakes or patterns worth automating
- Critical requirements that override default behavior
- Project-specific conventions that aren't obvious

**When NOT to add:**

- One-off situations or edge cases
- General best practices already covered in Claude's training
- Overly specific implementation details

---

## Avoid Unnecessary Re-exports

**Don't add "backward compatibility" re-exports.** TypeScript will catch breaking changes automatically.

```typescript
// ❌ Don't
import { MenuOption } from '../types/menu';
export type { MenuOption }; // Unnecessary

// ✅ Do
import { MenuOption } from '../types/menu';
// Use directly - TypeScript catches issues
```

## Git Workflow

Before starting work, run `git log --format="%h %ae %s" -20` and review all consecutive commits from the top by the current `git config user.email` author for context.

## MANDATORY: No Fallbacks

NO fallbacks, NO mock data, NO try/catch blocks unless explicitly requested. Report missing data as failure.

## MANDATORY: Never Claim Success Without Full Verification

Be brutally honest. List EXACTLY what you tested vs what you didn't. Partial completion = FAILURE. Report failures FIRST, then successes.

## Function Naming

Name functions as verbs: `dialNumber()` not `dial.number()`.

## Function Parameters

Use object parameters when a function has more than 2 parameters.

# Reminder: Did You Import the Right Rules?

Before completing a task, verify you read the relevant rule file from the top of this document
