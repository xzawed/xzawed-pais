import re
import os
import fnmatch

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

def is_excluded(path):
    for pattern in SONAR_EXCLUSIONS:
        if fnmatch.fnmatch(path, pattern):
            return True
        if pattern.endswith('/**'):
            base = pattern[:-3]
            if path.startswith(base + '/') or path == base:
                return True
    return False

# Load CI lcov
lcov_data = {}
for svc, lcov_path in CI_LCOV:
    if not os.path.exists(lcov_path):
        continue
    with open(lcov_path, encoding='utf-8', errors='replace') as f:
        content = f.read()
    for s in content.split('end_of_record'):
        sf = None
        da_map = {}
        for line in s.strip().split('\n'):
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

# Parse diff
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

# Detailed analysis per file
print('=== DETAILED NEW CODE COVERAGE (no coverage.exclusions) ===')
print()
total_cov = 0
total_uncov = 0

for full_path in sorted(new_lines_by_file.keys()):
    new_lines = new_lines_by_file[full_path]
    if not new_lines:
        continue
    if is_excluded(full_path):
        continue
    if not any(full_path.endswith(ext) for ext in ['.ts', '.tsx', '.js', '.jsx']):
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

    file_cov = 0
    file_uncov = 0
    uncovered_lines = []
    not_in_lcov_lines = []

    if da_map is None:
        not_in_lcov_lines = sorted(new_lines)
        file_uncov = len(not_in_lcov_lines)
    else:
        for lineno in sorted(new_lines):
            if lineno in da_map:
                if da_map[lineno] > 0:
                    file_cov += 1
                else:
                    file_uncov += 1
                    uncovered_lines.append(lineno)

    total_cov += file_cov
    total_uncov += file_uncov

    if file_uncov > 0:
        pct = 100.0 * file_cov / (file_cov + file_uncov) if (file_cov + file_uncov) > 0 else 0.0
        print(f'  {full_path}')
        print(f'    covered={file_cov}, uncovered={file_uncov}, pct={pct:.0f}%')
        if uncovered_lines:
            print(f'    uncovered lines: {uncovered_lines}')
        if not_in_lcov_lines:
            print(f'    not in lcov: {not_in_lcov_lines}')

total = total_cov + total_uncov
pct = 100.0 * total_cov / total if total > 0 else 0.0
print()
print(f'TOTAL: covered={total_cov}, uncovered={total_uncov}, total={total}, pct={pct:.1f}%')
print(f'Need {int(total * 0.80) - total_cov + 1} more covered to reach 80%')
