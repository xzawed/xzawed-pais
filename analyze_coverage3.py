import re
import os
import fnmatch

SERVICE_LCOV = {
    'xzawedOrchestrator': 'xzawedOrchestrator/packages/server/coverage/lcov.info',
    'xzawedManager': 'xzawedManager/packages/server/coverage/lcov.info',
    'xzawedDeveloper': 'xzawedDeveloper/coverage/lcov.info',
    'xzawedTester': 'xzawedTester/coverage/lcov.info',
    'xzawedBuilder': 'xzawedBuilder/coverage/lcov.info',
    'xzawedSecurity': 'xzawedSecurity/coverage/lcov.info',
    'xzawedWatcher': 'xzawedWatcher/coverage/lcov.info',
    'xzawedPlanner': 'xzawedPlanner/coverage/lcov.info',
}

# Patterns from sonar.exclusions (these files are completely excluded)
SONAR_EXCLUSIONS = [
    '**/*.test.ts', '**/*.spec.ts', '**/__tests__/**',
    '**/dist/**', '**/build/**', '**/.turbo/**', '**/*.d.ts', '**/node_modules/**',
    'xzawedOrchestrator/packages/server/src/streams/consumer.ts',
    '**/pnpm-lock.yaml', '**/package-lock.json',
    'xzawedLauncher/**',
    'xzawedOrchestrator/packages/server/src/projects/workspace.service.ts',
]

# Patterns from sonar.coverage.exclusions (these are excluded from coverage calc)
COVERAGE_EXCLUSIONS = [
    'xzawedOrchestrator/packages/app/src/renderer/src/components/**',
    'xzawedOrchestrator/packages/app/src/renderer/src/App.tsx',
    'xzawedOrchestrator/packages/app/src/renderer/src/main.tsx',
    'xzawedOrchestrator/packages/app/src/renderer/src/lib/api.ts',
    'xzawedOrchestrator/packages/app/src/renderer/src/lib/markdown.ts',
    'xzawedOrchestrator/packages/app/src/renderer/src/lib/utils.ts',
    'xzawedOrchestrator/packages/app/src/preload/**',
    'xzawedOrchestrator/packages/app/src/main/index.ts',
    'xzawedOrchestrator/packages/app/src/main/server-manager.ts',
    'xzawedOrchestrator/packages/app/src/main/github-oauth-handler.ts',
    'xzawedOrchestrator/packages/ui/src/components/**',
    '**/src/index.ts',
    'xzawedOrchestrator/packages/server/src/mcp/entry.ts',
    'xzawedOrchestrator/packages/server/src/db/**',
    'xzawedOrchestrator/packages/server/src/sessions/pg-session.store.ts',
    'xzawedOrchestrator/packages/server/src/sessions/message.repo.ts',
    'xzawedOrchestrator/packages/server/src/auth/user.repo.ts',
    'xzawedOrchestrator/packages/server/src/auth/refresh.repo.ts',
    'xzawedOrchestrator/packages/server/src/github-tokens/github-token.repo.ts',
    'xzawedOrchestrator/packages/server/src/streams/redis.client.ts',
    'xzawedOrchestrator/packages/server/src/manager/manager.client.ts',
    'xzawedOrchestrator/packages/server/src/ws/session.ws.ts',
    'xzawedOrchestrator/packages/server/src/claude/ssh-remote-runner.ts',
    'xzawedOrchestrator/packages/server/src/claude/api-runner.ts',
    'xzawedOrchestrator/packages/server/src/claude/intent-structurer.ts',
    'xzawedManager/packages/server/src/server.ts',
    'xzawedManager/packages/server/src/db/**',
    'xzawedManager/packages/server/src/types/**',
    'xzawedManager/packages/server/src/streams/redis.client.ts',
    'xzawedDesigner/src/server.ts',
    'xzawedDeveloper/src/server.ts',
    'xzawedSecurity/src/server.ts',
    'xzawedTester/src/server.ts',
    'xzawedWatcher/src/server.ts',
]

ALL_EXCLUSIONS = SONAR_EXCLUSIONS + COVERAGE_EXCLUSIONS

def is_excluded(path):
    """Check if a file path matches any exclusion pattern."""
    for pattern in ALL_EXCLUSIONS:
        if fnmatch.fnmatch(path, pattern):
            return True
        # Also check with /** suffix handling
        if pattern.endswith('/**'):
            base = pattern[:-3]
            if path.startswith(base + '/') or path == base:
                return True
    return False

# Load all lcov files
lcov_data = {}

for svc, lcov_path in SERVICE_LCOV.items():
    if not os.path.exists(lcov_path):
        continue
    with open(lcov_path, encoding='utf-8', errors='replace') as f:
        content = f.read()
    sections = content.split('end_of_record')
    for s in sections:
        lines_list = s.strip().split('\n')
        sf = None
        da_map = {}
        for line in lines_list:
            if line.startswith('SF:'):
                sf = line[3:].replace('\\', '/')
            elif line.startswith('DA:'):
                parts = line[3:].split(',')
                if len(parts) >= 2:
                    try:
                        lnum = int(parts[0])
                        hits = int(parts[1])
                        da_map[lnum] = da_map.get(lnum, 0) + hits
                    except ValueError:
                        pass
        if sf and da_map:
            key = (svc, sf)
            if key not in lcov_data:
                lcov_data[key] = {}
            for lnum, hits in da_map.items():
                lcov_data[key][lnum] = lcov_data[key].get(lnum, 0) + hits

# Parse git diff
with open('f:/tmp/pr_diff.txt', encoding='utf-8', errors='replace') as f:
    diff_text = f.read()

new_lines_by_file = {}

current_file = None
cur_line = 0

for line in diff_text.split('\n'):
    if line.startswith('+++ b/'):
        current_file = line[6:].replace('\\', '/')
        if current_file not in new_lines_by_file:
            new_lines_by_file[current_file] = set()
        cur_line = 0
    elif line.startswith('@@ '):
        m = re.search(r'\+(\d+)(?:,(\d+))?', line)
        if m:
            start = int(m.group(1))
            count_str = m.group(2)
            if count_str is not None and int(count_str) == 0:
                cur_line = 0
            else:
                cur_line = start
    elif current_file and line.startswith('+') and not line.startswith('+++'):
        if cur_line > 0:
            new_lines_by_file[current_file].add(cur_line)
            cur_line += 1
    elif current_file and line.startswith(' '):
        if cur_line > 0:
            cur_line += 1

# Cross-reference with exclusions
total_new_coverable = 0
total_new_covered = 0
uncovered_details = []
skipped_excluded = 0

for full_path, new_lines in new_lines_by_file.items():
    if not new_lines:
        continue

    # Skip excluded files
    if is_excluded(full_path):
        skipped_excluded += len(new_lines)
        continue

    svc = None
    for s in SERVICE_LCOV:
        if full_path.startswith(s + '/'):
            svc = s
            break
    if svc is None:
        continue

    rel_path = full_path[len(svc)+1:]

    da_map = None

    if (svc, rel_path) in lcov_data:
        da_map = lcov_data[(svc, rel_path)]

    if da_map is None:
        for prefix in ['packages/server/', 'packages/app/', 'packages/ui/']:
            if rel_path.startswith(prefix):
                short_rel = rel_path[len(prefix):]
                if (svc, short_rel) in lcov_data:
                    da_map = lcov_data[(svc, short_rel)]
                    break

    if da_map is None:
        basename = rel_path.split('/')[-1]
        matches = [(k, v) for k, v in lcov_data.items()
                   if k[0] == svc and (k[1].endswith('/' + basename) or k[1] == basename)]
        if len(matches) == 1:
            da_map = matches[0][1]
        elif len(matches) > 1:
            best = None
            best_len = 0
            for k, v in matches:
                rel_parts = rel_path.split('/')
                k_parts = k[1].split('/')
                common = sum(1 for a, b in zip(reversed(rel_parts), reversed(k_parts)) if a == b)
                if common > best_len:
                    best_len = common
                    best = v
            da_map = best

    if da_map is None:
        # File exists in diff but not in lcov - all new lines uncovered
        for lineno in sorted(new_lines):
            total_new_coverable += 1
            uncovered_details.append((full_path, lineno, 'NOT_IN_LCOV'))
        continue

    for lineno in sorted(new_lines):
        if lineno in da_map:
            total_new_coverable += 1
            if da_map[lineno] > 0:
                total_new_covered += 1
            else:
                uncovered_details.append((full_path, lineno, 'UNCOVERED'))

print(f'New lines skipped (excluded): {skipped_excluded}')
print(f'New lines in lcov (coverable): {total_new_coverable}')
print(f'New lines covered: {total_new_covered}')
if total_new_coverable > 0:
    pct = 100 * total_new_covered / total_new_coverable
    print(f'Coverage on new code (local estimate, excl-filtered): {pct:.1f}%')
    needed_for_80 = int(0.80 * total_new_coverable) - total_new_covered + 1
    print(f'Lines to cover to reach 80%: {needed_for_80}')
print()
print('=== UNCOVERED NEW LINES (after exclusions) ===')

by_file = {}
for path, lineno, reason in uncovered_details:
    by_file.setdefault(path, []).append((lineno, reason))

for path in sorted(by_file):
    lines_str = ', '.join(f'{ln}({r})' for ln, r in sorted(by_file[path]))
    print(f'  {path}: {lines_str}')
