import re
import os
import fnmatch

# All lcov files to load (service prefix -> list of lcov paths)
ALL_LCOV = [
    ('xzawedOrchestrator', 'xzawedOrchestrator/packages/server/coverage/lcov.info', 'packages/server/'),
    ('xzawedOrchestrator', 'xzawedOrchestrator/packages/app/coverage/lcov.info', 'packages/app/'),
    ('xzawedOrchestrator', 'xzawedOrchestrator/packages/ui/coverage/lcov.info', 'packages/ui/'),
    ('xzawedManager', 'xzawedManager/packages/server/coverage/lcov.info', 'packages/server/'),
    ('xzawedDeveloper', 'xzawedDeveloper/coverage/lcov.info', ''),
    ('xzawedTester', 'xzawedTester/coverage/lcov.info', ''),
    ('xzawedBuilder', 'xzawedBuilder/coverage/lcov.info', ''),
    ('xzawedSecurity', 'xzawedSecurity/coverage/lcov.info', ''),
    ('xzawedWatcher', 'xzawedWatcher/coverage/lcov.info', ''),
    ('xzawedPlanner', 'xzawedPlanner/coverage/lcov.info', ''),
]

SONAR_EXCLUSIONS = [
    '**/*.test.ts', '**/*.spec.ts', '**/__tests__/**',
    '**/dist/**', '**/build/**', '**/.turbo/**', '**/*.d.ts', '**/node_modules/**',
    'xzawedOrchestrator/packages/server/src/streams/consumer.ts',
    '**/pnpm-lock.yaml', '**/package-lock.json',
    'xzawedLauncher/**',
    'xzawedOrchestrator/packages/server/src/projects/workspace.service.ts',
]

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
    for pattern in ALL_EXCLUSIONS:
        if fnmatch.fnmatch(path, pattern):
            return True
        if pattern.endswith('/**'):
            base = pattern[:-3]
            if path.startswith(base + '/') or path == base:
                return True
    return False

# Load all lcov files
lcov_data = {}  # (svc, relative_sf) -> {line: hits}

for svc, lcov_path, pkg_prefix in ALL_LCOV:
    if not os.path.exists(lcov_path):
        print(f'  MISSING: {lcov_path}')
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
                        da_map[int(parts[0])] = da_map.get(int(parts[0]), 0) + int(parts[1])
                    except ValueError:
                        pass
        if sf and da_map:
            # Full path from repo root
            full_sf = svc + '/' + pkg_prefix + sf
            # Also store without pkg_prefix for direct matching
            if full_sf not in lcov_data:
                lcov_data[full_sf] = {}
            for lnum, hits in da_map.items():
                lcov_data[full_sf][lnum] = lcov_data[full_sf].get(lnum, 0) + hits

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
            cur_line = 0 if (count_str is not None and int(count_str) == 0) else start
    elif current_file and line.startswith('+') and not line.startswith('+++'):
        if cur_line > 0:
            new_lines_by_file[current_file].add(cur_line)
            cur_line += 1
    elif current_file and line.startswith(' '):
        if cur_line > 0:
            cur_line += 1

# Cross-reference
total_new_coverable = 0
total_new_covered = 0
uncovered_details = []
skipped_excluded = 0
no_lcov_files = set()

for full_path, new_lines in new_lines_by_file.items():
    if not new_lines:
        continue
    if is_excluded(full_path):
        skipped_excluded += len(new_lines)
        continue

    # Check if this is a code file (only .ts/.tsx/.js/.jsx files matter for coverage)
    if not any(full_path.endswith(ext) for ext in ['.ts', '.tsx', '.js', '.jsx']):
        continue

    # Look up in lcov_data (direct match first)
    da_map = lcov_data.get(full_path)

    if da_map is None:
        # Try variations
        for key in lcov_data:
            if key.endswith('/' + full_path.split('/')[-1]):
                # Find best suffix match
                fp_parts = full_path.split('/')
                k_parts = key.split('/')
                common = sum(1 for a, b in zip(reversed(fp_parts), reversed(k_parts)) if a == b)
                if common >= 2:  # At least 2 path parts match
                    da_map = lcov_data[key]
                    break

    if da_map is None:
        no_lcov_files.add(full_path)
        # File has no coverage data - all new lines uncovered
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

print(f'Lines skipped (excluded patterns): {skipped_excluded}')
print(f'New coverable lines (in lcov or no-lcov): {total_new_coverable}')
print(f'New covered lines: {total_new_covered}')
if total_new_coverable > 0:
    pct = 100 * total_new_covered / total_new_coverable
    print(f'Coverage estimate: {pct:.1f}%')
    needed = int(0.80 * total_new_coverable) - total_new_covered + 1
    print(f'Lines to cover for 80%: {needed}')
print()

print('=== UNCOVERED NEW LINES (non-excluded) ===')
by_file = {}
for path, lineno, reason in uncovered_details:
    by_file.setdefault(path, []).append((lineno, reason))
for path in sorted(by_file):
    lines_str = ', '.join(f'{ln}({r})' for ln, r in sorted(by_file[path]))
    print(f'  {path}: {lines_str}')

if no_lcov_files:
    print()
    print('=== Files with NO lcov data ===')
    for f in sorted(no_lcov_files):
        print(f'  {f}')
