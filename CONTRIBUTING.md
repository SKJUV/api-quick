# Contributing to api-quick

First off, thank you for considering contributing to `api-quick`! It's contributions like yours that make `api-quick` an incredible tool for developers worldwide.

## Code of Conduct

This project and everyone participating in it is governed by the [api-quick Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Bugs are tracked as [GitHub Issues](https://github.com/SKJUV/api-quick/issues). Before creating a bug report, please check existing issues to avoid duplicates.

When filing a bug report, please include:
- **Environment details**: Node/Bun version, OS (`linux`, `darwin`, `win32`), `api-quick` version.
- **Steps to reproduce**: Clear CLI commands or workflow steps.
- **Expected vs Actual behavior**.
- **Error logs** or terminal trace.

### Suggesting Enhancements

Feature requests are welcome! Please open an issue with:
- A clear, descriptive title.
- A detailed explanation of the problem or use case.
- Proposed solution or syntax example.

### Submitting Pull Requests

1. **Fork the Repository**: Create your feature branch off `main` (`git checkout -b feat/amazing-feature`).
2. **Setup Development Environment**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/api-quick.git
   cd api-quick
   npm install
   ```
3. **Write Clean, Tested Code**:
   - Follow strict TypeScript type definitions (`noImplicitAny`, `strictNullChecks`).
   - Add unit/integration tests in the `tests/` directory.
   - Run tests: `npm test`.
   - Run linter: `npm run lint`.
4. **Commit Conventions**:
   Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: add tree-sitter AST sniffer for Go routes`
   - `fix: resolve SQLite WAL lock contention on abrupt exit`
   - `docs: update assertion DSL grammar specification`
   - `test: add E2E assertion evaluation tests`
5. **Open a Pull Request**: Provide a detailed description of changes and link relevant issues.

## Development Workflow

- Monorepo structured with `src/` (Core CLI/Engine) and `web/` (React SPA Web UI).
- Run CLI locally in watch mode: `npm run dev`
- Run Web UI locally: `npm run dev:web`

Thank you for building the future of API developer tools with us!
