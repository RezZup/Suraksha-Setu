# Agent Backpressure & Verification Rules

This file defines the verification steps that the agent (Antigravity/Ralph) must perform to ensure work quality.

## Mandatory Verifications
Before marking any task as complete, the agent SHOULD:
1. **Linting**: Run lints on modified files.
2. **Build**: Ensure the backend/frontend builds without errors.
3. **Tests**: Run relevant unit tests.

## Commands
### Backend
- **Verify Dependencies**: `pip check`
- **Run Tests**: `pytest backend/tests` (to be created)
- **Check DB**: `python backend/check_database.py` (if kept)

### Frontend
- **Lint**: `npm run lint` (in frontend dir)
- **Build**: `npm run build` (in frontend dir)

## Full Wiggum Mode Rules
- Proceed with terminal executions unless they are destructive.
- If a test fails, the agent MUST attempt to fix it before proceeding.
- If a build fails, the agent MUST revert or fix the change immediately.
