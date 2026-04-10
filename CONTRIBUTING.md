# Contributing to mcp-shield

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/DainoJung/mcp-shield.git
cd mcp-shield
npm install
npm test        # run tests
npm run build   # build
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add tests for any new functionality
4. Ensure all tests pass: `npm test`
5. Ensure types are correct: `npm run typecheck`
6. Open a pull request

## Guidelines

- **Tests required** — all new features and bug fixes need tests
- **TypeScript strict mode** — no `any` types, no type assertions unless necessary
- **stdout is sacred** — never write to stdout (reserved for MCP protocol). Use stderr for all logging
- **Keep it small** — avoid adding dependencies unless absolutely necessary

## Reporting Issues

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Node.js version and OS

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
