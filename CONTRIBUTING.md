# Contributing

Thanks for your interest. Bug reports and pull requests are welcome.

## Development setup

Requirements: Node.js 24 or newer.

```bash
npm ci
npm run dev
```

The API runs on port 3001 and the Vite dev server on port 5173 (or the next free port).

## Checks

Run these before opening a pull request. CI runs the same checks.

```bash
npm run lint
npm test
npm run build
```

Behaviour changes need tests. Server changes are covered in `server/*.test.js`,
calculation changes in `src/lib/*.test.js`.

## Pull requests

- Keep one logical change per pull request.
- Describe what changed and why, and how you tested it.
- Every pull request needs a passing CI run and a review from the code owner.
- Do not commit local data or configuration: `oil.db`, `.env` and `.claude/` are ignored.

## Commit messages

- Imperative subject, at most 72 characters, for example `Add water meter pairing test`.
- The body explains why the change is needed when that is not obvious from the diff.

## Security issues

Do not report security problems in public issues. See [SECURITY.md](SECURITY.md).
