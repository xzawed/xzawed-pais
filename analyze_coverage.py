import subprocess
import re
import os

# Map service dirs to their lcov paths
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

# Load all lcov files - build map: (service, sf_path) -> {line: hits}
lcov_data = {}  # key: (service, normalized_sf) -> {line: hits}

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
                        # merge multiple sections
                        da_map[lnum] = da_map.get(lnum, 0) + hits
                    except ValueError:
                        pass
        if sf and da_map:
            key = (svc, sf)
            if key not in lcov_data:
                lcov_data[key] = {}
            for lnum, hits in da_map.items():
                lcov_data[key][lnum] = lcov_data[key].get(lnum, 0) + hits

# Parse git diff to get new lines per file
diff_result = subprocess.run(
    ['git', 'diff', 'master...HEAD', '-U0'],
    capture_output=True, text=True, cwd='.'
)
diff_text = diff_result.stdout

new_lines_by_file = {}  # full_path (slash) -> set of new line numbers

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
            # count=0 means no lines added in this hunk
            cur_line = start if (count_str is None or int(count_str) != 0) else 0
    elif current_file and line.startswith('+') and not line.startswith('+++'):
        if cur_line > 0:
            new_lines_by_file[current_file].add(cur_line)
            cur_line += 1
    elif current_file and line.startswith(' '):
        if cur_line > 0:
            cur_line += 1

# Cross-reference: for each new line in changed files, check if covered
total_new_coverable = 0
total_new_covered = 0
uncovered_details = []
covered_details = []

for full_path, new_lines in new_lines_by_file.items():
    if not new_lines:
        continue

    # Determine which service this file belongs to
    svc = None
    for s in SERVICE_LCOV:
        if full_path.startswith(s + '/'):
            svc = s
            break
    if svc is None:
        continue

    # Get relative path within service
    rel_path = full_path[len(svc)+1:]  # e.g. 'packages/server/src/config.ts' or 'src/security.ts'

    # Find matching lcov entry
    da_map = None

    # Try direct match
    direct_key = (svc, rel_path)
    if direct_key in lcov_data:
        da_map = lcov_data[direct_key]

    # Try with src/ prefix (for turborepo packages)
    if da_map is None:
        # Strip packages/server/ or packages/app/ prefix
        for prefix in ['packages/server/', 'packages/app/', 'packages/ui/']:
            if rel_path.startswith(prefix):
                short_rel = rel_path[len(prefix):]
                k = (svc, short_rel)
                if k in lcov_data:
                    da_map = lcov_data[k]
                    break

    # Try to find by filename suffix
    if da_map is None:
        basename = rel_path.split('/')[-1]
        matches = [(k, v) for k, v in lcov_data.items() if k[0] == svc and k[1].endswith(basename)]
        if len(matches) == 1:
            da_map = matches[0][1]
        elif len(matches) > 1:
            # Try to find best match by path overlap
            for k, v in matches:
                if rel_path.endswith(k[1]) or k[1].endswith(rel_path.split('src/')[-1] if 'src/' in rel_path else rel_path):
                    da_map = v
                    break

    if da_map is None:
        continue

    for lineno in sorted(new_lines):
        if lineno in da_map:
            total_new_coverable += 1
            if da_map[lineno] > 0:
                total_new_covered += 1
                covered_details.append((full_path, lineno, da_map[lineno]))
            else:
                uncovered_details.append((full_path, lineno))

print(f'New lines in lcov (coverable): {total_new_coverable}')
print(f'New lines covered: {total_new_covered}')
if total_new_coverable > 0:
    pct = 100 * total_new_covered / total_new_coverable
    print(f'Coverage on new code: {pct:.1f}%')
    needed = int(0.80 * total_new_coverable) - total_new_covered + 1
    print(f'Lines to cover to reach 80%: {needed}')
print()
print('=== UNCOVERED NEW LINES ===')

by_file = {}
for path, lineno in uncovered_details:
    by_file.setdefault(path, []).append(lineno)

for path in sorted(by_file):
    print(f'  {path}: lines {sorted(by_file[path])}')
