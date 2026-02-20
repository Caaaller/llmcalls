## Frontend Conventions

### Technologies

- **React 18+** with functional components and hooks
- **TypeScript** with strict typing
- **Emotion** for CSS-in-JS styling
- **Jest** + **React Testing Library** for tests
- **react-intl** for internationalization
- **Playwright** for browser automation ([playwright-skill](https://github.com/lackeyjb/playwright-skill))
- **MapLibre GL** for map rendering
- **Vite** for dev server and bundling

### TypeScript

#### No `any` Type

Use specific interfaces, union types, generics, or `unknown` with type guards.

#### No Type Assertions

Never use `as`. Use type guards instead:

```typescript
function isStatus(value: string): value is Status {
  return Object.values(Status).includes(value as Status);
}
```

#### Parameter Types

Declare separately, let TypeScript infer return types:

```typescript
interface UseDataProps {
  readonly actionId: string;
}
export const useData = ({ actionId }: UseDataProps) => {
  /* inferred return */
};
```

#### Syntax Preferences

- Use `Array<TheType>` not `TheType[]`
- Use `??` not `||` for defaults
- Use `?.` for optional chaining

### React Components

#### Structure

- One component per file, use `React.FC`
- Props interface named `Props` or `ComponentNameProps`

#### Conditional Rendering

Use ternary, not `&&`:

```typescript
{
  subtitle ? <h2>{subtitle}</h2> : null;
}
```

#### Memoization

Only when strictly necessary. Don't memoize simple state setters.

#### Event Handlers

Inline single-use simple functions: `<Button onClick={() => setIsOpen(false)} />`

#### JSX-Returning Functions

Make them components, not functions:

```typescript
// Bad
const renderHeader = () => <Header />;

// Good
const HeaderSection: React.FC = () => (
  <Header />
);
```

#### Disabled Buttons

Must have tooltip explaining why disabled.

### Styling

#### Units & Spacing

Use a `rem()` utility for spacing. Use multiples of 8 (4 acceptable for small values).

```typescript
const rem = (px: number) => `${px / 16}rem`;
```

#### Styled Components

Break out to `styled.<element>` when 3+ CSS attributes:

```typescript
const StyledCard = styled.div`
  display: flex;
  padding: ${rem(16)};
  gap: ${rem(8)};
`;
```

Never define styled components inside functional components.

#### Colors

Always from theme. Never hardcode hex values.

#### Text

Use consistent text variants. Never customize line-height, weight, or size ad-hoc.

#### Layout

Create reusable flex utilities:

```typescript
const FlexRow = styled.div`
  display: flex;
  flex-direction: row;
`;
const FlexColumn = styled.div`
  display: flex;
  flex-direction: column;
`;
const FlexCenter = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`;
```

#### Layout Spacing

Parent handles spacing, not child:

```typescript
// Good - parent handles margin
<Layout css={{ gap: rem(10) }}>
  <InputA />
</Layout>;

// Bad - child has built-in margin
const InputA = () => (
  <div style={{ marginTop: rem(24) }}>
    ...
  </div>
);
```

### Internationalization

#### FormattedMessage

Use react-intl's FormattedMessage for all user-facing strings:

```typescript
import { FormattedMessage } from "react-intl";
<FormattedMessage id="some.message.id" />;
```

#### Message IDs

Use dot-notation hierarchy: `feature.component.element`

### Naming Conventions

| Type               | Convention                                                              | Example                                    |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------ |
| Variables/Props    | lowerCamelCase                                                          | `actionId`, `isLoading`                    |
| Constants          | UPPER_SNAKE_CASE                                                        | `MAX_RETRIES`                              |
| Components/Classes | UpperCamelCase                                                          | `UserProfile`                              |
| Hooks              | useNoun                                                                 | `usePermissions` (not `useGetPermissions`) |
| Enum keys          | UPPER_SNAKE_CASE                                                        | `Status.ACTIVE`                            |
| Event props        | onEvent/handleEvent                                                     | `onTodayClick` / `handleTodayClick`        |
| Files              | UpperCamelCase.tsx                                                      | `UserProfile.tsx`                          |
| Postfixes          | `.spec.tsx`, `.types.tsx`, `.utils.tsx`, `.mocks.tsx`, `.constants.tsx` |

Booleans start with `is`, `should`, `has`. Don't include "Component" in component names.

### Patterns

#### Prefer Calculation Over Mutation

Use `map`/`reduce` over declaring and augmenting:

```typescript
// Good
const items = data.map(d => ({
  ...d,
  active: true,
}));

// Bad
const items = [];
data.forEach(d => items.push({ ...d, active: true }));
```

#### Maps Over Switch

```typescript
const statusLabels: Record<Status, string> = {
  [Status.ACTIVE]: 'Active',
  [Status.INACTIVE]: 'Inactive',
};
```

#### No Over-Engineering

- Only make directly requested changes
- Don't add features, error handling, or abstractions beyond what was asked
- No defensive code, fallbacks, or try/catch unless explicitly requested

#### Comments

Never add unless explicitly asked.
