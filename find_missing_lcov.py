import re
import os
import fnmatch

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

# Build lcov key set
lcov_files = set()
for svc, lcov_path, pkg_hint in CI_LCOV:
    if not os.path.exists(lcov_path):
        continue
    with open(lcov_path, encoding='utf-8', errors='replace') as f:
        content = f.read()
    for s in content.split('end_of_record'):
        for line in s.strip().split('\n'):
            if line.startswith('SF:'):
                sf = line[3:].replace('\\', '/')
                if 'ci_orc/server' in lcov_path:
                    full = 'xzawedOrchestrator/packages/server/' + sf
                elif 'ci_orc/ui' in lcov_path:
                    full = 'xzawedOrchestrator/packages/ui/' + sf
                elif 'ci_orc/app' in lcov_path:
                    full = 'xzawedOrchestrator/packages/app/' + sf
                elif 'xzawedManager' in lcov_path:
                    full = 'xzawedManager/packages/server/' + sf
                else:
                    full = svc + '/' + sf
                lcov_files.add(full)

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

print("Files in diff, NOT excluded, NOT in any CI lcov:")
total_missing = 0
for full_path in sorted(new_lines_by_file.keys()):
    new_lines = new_lines_by_file[full_path]
    if not new_lines:
        continue
    if is_excluded(full_path):
        continue
    if not any(full_path.endswith(ext) for ext in ['.ts', '.tsx', '.js', '.jsx']):
        continue
    if full_path in lcov_files:
        continue
    matched = False
    for key in lcov_files:
        kparts = key.split('/')
        fparts = full_path.split('/')
        if len(kparts) >= 2 and len(fparts) >= 2:
            if kparts[-1] == fparts[-1] and kparts[-2] == fparts[-2]:
                common = sum(1 for a, b in zip(reversed(kparts), reversed(fparts)) if a == b)
                if common >= 3:
                    matched = True
                    break
    if not matched:
        print('  ' + full_path + ': ' + str(len(new_lines)) + ' new lines')
        total_missing += len(new_lines)

print('Total missing new lines: ' + str(total_missing))
