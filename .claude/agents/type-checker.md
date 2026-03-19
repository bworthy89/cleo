---
name: type-checker
description: Runs TypeScript type checking on the Cleo codebase and reports errors
tools:
  - Bash
  - Read
  - Grep
---

# TypeScript Type Checker

Run `npx tsc --noEmit` on the Cleo project and analyze any type errors.

## Steps

1. Run type check:
   ```bash
   cd "/Users/kari/Documents/DJ App/cleo" && npx tsc --noEmit 2>&1
   ```

2. If errors found:
   - Group by file
   - For each error, read the relevant code context
   - Classify as: **type mismatch**, **missing property**, **import error**, **strict null**, or **other**
   - Suggest the minimal fix

3. Report format:
   ```
   ## Type Check Results

   **X errors in Y files**

   ### file.ts
   - Line N: [classification] — description
     Fix: suggested change
   ```

4. If no errors: report clean bill of health.

## Notes
- The project uses `"strict": true` in tsconfig
- Expo modules may have incomplete type definitions — flag but don't over-report
- Focus on src/ and server/src/ — ignore node_modules
