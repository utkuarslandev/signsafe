# Repository Guidelines

## Project Structure & Module Organization
This repository is currently an empty scaffold. Keep the root clean and add code under a predictable layout as the project grows:

- `src/` for application code
- `tests/` for automated tests
- `assets/` for static files such as images or sample data
- `docs/` for design notes, ADRs, or integration guides

Favor small, focused modules. Group related code by feature or domain, and keep tests near the root-level `tests/` tree unless the project later adopts co-located test files.

## Build, Test, and Development Commands
No build system is configured yet. When adding one, document the commands in `README.md` and keep them stable. Preferred conventions:

- `npm install` or `pnpm install` to install dependencies
- `npm run dev` for local development
- `npm test` for the full test suite
- `npm run lint` for static checks
- `npm run build` for production artifacts

If another toolchain is chosen, keep command names familiar and avoid one-off scripts without documentation.

## Coding Style & Naming Conventions
Use 2-space indentation for JavaScript, TypeScript, JSON, YAML, and Markdown. Prefer:

- `PascalCase` for classes and React components
- `camelCase` for variables and functions
- `kebab-case` for file names, for example `auth-service.ts`

Adopt a formatter and linter early (`Prettier` and `ESLint` are the default recommendation) and commit their config files at the repo root.

## Testing Guidelines
Add automated tests with each feature or bug fix. Name test files `*.test.*` or `*.spec.*` and mirror the source layout where possible, for example `tests/auth/login.test.ts`.

Pick one test runner and standardize on it. If coverage is enabled, target meaningful coverage for critical paths rather than chasing a raw percentage.

## Commit & Pull Request Guidelines
This directory does not yet contain Git history, so no local commit convention exists to mirror. Until one is established, use short imperative commit messages such as `Add auth token validator`.

Pull requests should include:

- a clear summary of what changed
- linked issue or task reference when available
- test evidence (`npm test`, screenshots, or manual verification notes)
- any setup or migration notes reviewers need

## Security & Configuration Tips
Do not commit secrets, API keys, or `.env` files. Add local-only config files to `.gitignore` before introducing credentials or environment-specific settings.
