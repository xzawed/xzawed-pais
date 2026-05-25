import re
import os
import fnmatch

# Only apply sonar.exclusions (NOT coverage.exclusions)
# to simulate what SonarCloud might do for coverage on new code

CI_LCOV = [
    ('xzawedOrchestrator', 'f:/tmp/ci_orc/server/coverage/lcov.info'),
    ('xzawedOrchestrator', 'f:/tmp/ci_orc/ui/coverage/lcov.info'),
    ('xzawedOrchestrator', 'f:/tmp/ci_orc/app/coverage/lcov.info'),
    ('xzawedManager', 'f:/tmp/ci_xzawedManager/server/coverage/lcov.info'),
    ('xzawedDeveloper', 'f:/tmp/ci_xzawedDeveloper/lcov.info'),
    ('xzawedTester', 'f:/tmp/ci_xzawedTester/lcov.info'),
    ('xzawedBuilder', 'f:/tmp/ci_xzawedBuilder/lcov.info'),
    ('xzawedSecurity', 'f:/tmp/ci_xzawedSecurity/lcov.info'),
    ('xzawedWatcher', 'f:/tmp/ci_xzawedWatcher/lcov.info'),
    ('xzawedPlanner', 'f:/tmp/ci_xzawedPlanner/lcov.info'),
]

SONAR_EXCLUSIONS = [
    '**/*.test.ts', '**/*.spec.ts', '**/__tests__/**',
    '**/dist/**', '**/build/**', '**/.turbo/**', '**/*.d.ts', '**/node_modules/**',
    'xzawedOrchestrator/packages/server/src/streams/consumer.ts',
    '**/pnpm-lock.yaml', '**/package-lock.json',
    'xzawedLauncher/**',
    'xzawedOrchestrator/packages/server/src/projects/workspace.service.ts',
]

# coverage.exclusions - try with and without
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

def is_excluded_sonar_only(path):
    for pattern in SONAR_EXCLUSIONS:
        if fnmatch.fnmatch(path, pattern):
            return True
        if pattern.endswith('/**'):
            base = pattern[:-3]
            if path.startswith(base + '/') or path == base:
                return True
    return False

def is_coverage_excluded(path):
    for pattern in COVERAGE_EXCLUSIONS:
        if fnmatch.fnmatch(path, pattern):
            return True
        if pattern.endswith('/**'):
            base = pattern[:-3]
            if path.startswith(base + '/') or path == base:
                return True
    return False

# Load CI lcov files
lcov_data = {}

for svc, lcov_path in CI_LCOV:
    if not os.path.exists(lcov_path):
        print('MISSING: ' + lcov_path)
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

def analyze(use_coverage_exclusions):
    total_cov = 0
    total_uncov = 0
    uncovered_details = []
    skipped_sonar = 0
    skipped_cov_excl = 0

    for full_path, new_lines in sorted(new_lines_by_file.items()):
        if not new_lines:
            continue
        if is_excluded_sonar_only(full_path):
            skipped_sonar += len(new_lines)
            continue
        if not any(full_path.endswith(ext) for ext in ['.ts', '.tsx', '.js', '.jsx']):
            continue
        if use_coverage_exclusions and is_coverage_excluded(full_path):
            skipped_cov_excl += len(new_lines)
            continue

        da_map = lcov_data.get(full_path)
        if da_map is None:
            for key in lcov_data:
                kparts = key.split('/')
                fparts = full_path.split('/')
                if len(kparts) >= 2 and len(fparts) >= 2:
                    if kparts[-1] == fparts[-1] and kparts[-2] == fparts[-2]:
                        common = sum(1 for a, b in zip(reversed(kparts), reversed(fparts)) if a == b)
                        if common >= 3:
                            da_map = lcov_data[key]
                            break

        if da_map is None:
            # Count all new lines as uncovered
            for lineno in sorted(new_lines):
                total_uncov += 1
                uncovered_details.append((full_path, lineno, 'NOT_IN_LCOV'))
            continue

        for lineno in sorted(new_lines):
            if lineno in da_map:
                if da_map[lineno] > 0:
                    total_cov += 1
                else:
                    total_uncov += 1
                    uncovered_details.append((full_path, lineno, 'UNCOVERED'))

    total = total_cov + total_uncov
    pct = 100.0 * total_cov / total if total > 0 else 0.0
    return total_cov, total_uncov, pct, uncovered_details, skipped_sonar, skipped_cov_excl

print('=== WITH sonar.coverage.exclusions applied (my current analysis) ===')
cov, uncov, pct, details, skip_s, skip_c = analyze(True)
print(f'Covered: {cov}, Uncovered: {uncov}, Total: {cov+uncov}, Coverage: {pct:.1f}%')
print(f'Skipped (sonar.exclusions): {skip_s}, Skipped (coverage.exclusions): {skip_c}')

print()
print('=== WITHOUT sonar.coverage.exclusions (simulating Sonar ignoring them) ===')
cov2, uncov2, pct2, details2, skip_s2, skip_c2 = analyze(False)
print(f'Covered: {cov2}, Uncovered: {uncov2}, Total: {cov2+uncov2}, Coverage: {pct2:.1f}%')
print()
print('Top uncovered files (no cov exclusions):')
by_file = {}
for path, lineno, reason in details2:
    by_file.setdefault(path, []).append((lineno, reason))
for path in sorted(by_file.keys()):
    entries = sorted(by_file[path])
    count = len(entries)
    print(f'  {path}: {count} lines uncovered')
