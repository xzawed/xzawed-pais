import re
import os
import fnmatch

# CI coverage file locations (downloaded from CI artifacts)
CI_LCOV = [
    ('xzawedOrchestrator', 'f:/tmp/ci_orc/server/coverage/lcov.info', 'src/'),
    ('xzawedOrchestrator', 'f:/tmp/ci_orc/ui/coverage/lcov.info', 'src/'),
    ('xzawedOrchestrator', 'f:/tmp/ci_orc/app/coverage/lcov.info', 'src/'),
    ('xzawedManager', 'f:/tmp/ci_xzawedManager/server/coverage/lcov.info', 'src/'),
    ('xzawedDeveloper', 'f:/tmp/ci_xzawedDeveloper/lcov.info', 'src/'),
    ('xzawedTester', 'f:/tmp/ci_xzawedTester/lcov.info', 'src/'),
    ('xzawedBuilder', 'f:/tmp/ci_xzawedBuilder/lcov.info', 'src/'),
    ('xzawedSecurity', 'f:/tmp/ci_xzawedSecurity/lcov.info', 'src/'),
    ('xzawedWatcher', 'f:/tmp/ci_xzawedWatcher/lcov.info', 'src/'),
    ('xzawedPlanner', 'f:/tmp/ci_xzawedPlanner/lcov.info', 'src/'),
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

# Load CI lcov files
# Build map: full_path -> {line: hits}
# full_path = svc + '/' + package_prefix + sf_path
lcov_data = {}  # full_path -> {line: hits}

for svc, lcov_path, pkg_hint in CI_LCOV:
    if not os.path.exists(lcov_path):
        print(f'MISSING: {lcov_path}')
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
            # Try to construct full path
            # For Orchestrator: sf might be 'src/api/sessions.route.ts'
            # The lcov is from packages/server, so full = xzawedOrchestrator/packages/server/src/...
            # But we don't know which package (server/ui/app) the lcov is from
            # Use the file path to hint
            if 'ci_orc/server' in lcov_path:
                full = f'xzawedOrchestrator/packages/server/{sf}'
            elif 'ci_orc/ui' in lcov_path:
                full = f'xzawedOrchestrator/packages/ui/{sf}'
            elif 'ci_orc/app' in lcov_path:
                full = f'xzawedOrchestrator/packages/app/{sf}'
            elif 'xzawedManager' in lcov_path:
                full = f'xzawedManager/packages/server/{sf}'
            else:
                full = f'{svc}/{sf}'

            if full not in lcov_data:
                lcov_data[full] = {}
            for lnum, hits in da_map.items():
                lcov_data[full][lnum] = lcov_data[full].get(lnum, 0) + hits

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

# Analysis
total_new_coverable = 0
total_new_covered = 0
uncovered_details = []
no_lcov_files = {}

for full_path, new_lines in new_lines_by_file.items():
    if not new_lines:
        continue
    if is_excluded(full_path):
        continue
    if not any(full_path.endswith(ext) for ext in ['.ts', '.tsx', '.js', '.jsx']):
        continue

    da_map = lcov_data.get(full_path)

    # Try partial path matching
    if da_map is None:
        for key in lcov_data:
            kparts = key.split('/')
            fparts = full_path.split('/')
            if len(kparts) >= 2 and len(fparts) >= 2:
                if kparts[-1] == fparts[-1] and kparts[-2] == fparts[-2]:
                    # Same file and parent dir
                    common = sum(1 for a, b in zip(reversed(kparts), reversed(fparts)) if a == b)
                    if common >= 3:
                        da_map = lcov_data[key]
                        break

    if da_map is None:
        no_lcov_files[full_path] = list(sorted(new_lines))[:10]
        continue

    for lineno in sorted(new_lines):
        if lineno in da_map:
            total_new_coverable += 1
            if da_map[lineno] > 0:
                total_new_covered += 1
            else:
                uncovered_details.append((full_path, lineno))

print(f'New coverable lines (in lcov, non-excluded): {total_new_coverable}')
print(f'New covered lines: {total_new_covered}')
if total_new_coverable > 0:
    pct = 100 * total_new_covered / total_new_coverable
    print(f'Coverage on new code (CI lcov, excl-filtered): {pct:.1f}%')
    needed = int(0.80 * total_new_coverable) - total_new_covered + 1
    print(f'Lines to cover to reach 80%: {needed}')
print()

print('=== UNCOVERED NEW LINES (non-excluded) ===')
by_file = {}
for path, lineno in uncovered_details:
    by_file.setdefault(path, []).append(lineno)
for path in sorted(by_file):
    print(f'  {path}: {sorted(by_file[path])}')

if no_lcov_files:
    print()
    print('=== Files NOT in CI lcov (treated as uncovered by SonarCloud) ===')
    for path, lines in sorted(no_lcov_files.items()):
        print(f'  {path}: first lines {lines}')
