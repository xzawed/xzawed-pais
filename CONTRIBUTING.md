# Contributing to xzawedPAIS

Thank you for your interest in contributing!

## Quick Start

```bash
git clone https://github.com/xzawed/xzawed-pais.git
cd xzawed-pais

# Install a service
cd xzawedDeveloper && pnpm install

# Run tests
pnpm test

# Check for vulnerabilities
pnpm audit
```

## Workflow

All changes go through Pull Requests. Direct pushes to `master` are not allowed.

```
Branch → Work → Tests pass → Build succeeds → pnpm audit clean → Open PR
```

### Branch naming

```
feat/<service>/<description>   # new feature
fix/<service>/<description>    # bug fix
docs/<description>             # documentation only
chore/<description>            # dependencies, config
```

### PR checklist

- [ ] `pnpm test` — all tests pass
- [ ] `pnpm build` — TypeScript compiles without errors
- [ ] `pnpm audit` — zero moderate+ vulnerabilities

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat(developer): add file diff preview before applying changes
fix(security): resolve false-positive on test fixture files
chore(deps): upgrade vitest 2→3
```

## Full guide

For detailed setup instructions, architecture principles, and code review criteria, see [`docs/internal/contributing.md`](./docs/internal/contributing.md).
