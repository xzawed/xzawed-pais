def get_coverage_by_file(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        content = f.read()
    sections = content.split('end_of_record')
    result = {}
    for s in sections:
        sf = None
        uncovered = []
        lh = 0
        lf = 0
        for line in s.split('\n'):
            if line.startswith('SF:'):
                sf = line[3:].replace('\\', '/')
            elif line.startswith('DA:'):
                parts = line[3:].split(',')
                if len(parts) >= 2:
                    try:
                        if int(parts[1]) == 0:
                            uncovered.append(int(parts[0]))
                    except: pass
            elif line.startswith('LH:'):
                try: lh = int(line[3:])
                except: pass
            elif line.startswith('LF:'):
                try: lf = int(line[3:])
                except: pass
        if sf:
            result[sf] = {'lh': lh, 'lf': lf, 'uncovered': uncovered}
    return result

ci_server = get_coverage_by_file('f:/tmp/ci_orc/server/coverage/lcov.info')
local_server = get_coverage_by_file('xzawedOrchestrator/packages/server/coverage/lcov.info')

print(f'CI server files: {len(ci_server)}, Local server files: {len(local_server)}')
print()

# Find differences
for sf in sorted(ci_server):
    ci_data = ci_server[sf]
    local_data = local_server.get(sf, {})
    ci_cov = ci_data['lh'] / ci_data['lf'] * 100 if ci_data['lf'] else 0
    local_cov = local_data.get('lh', 0) / local_data.get('lf', 1) * 100 if local_data.get('lf') else 0
    if abs(ci_cov - local_cov) > 3 or (sf not in local_server):
        print(f'  DIFF {sf}: CI={ci_data["lh"]}/{ci_data["lf"]}={ci_cov:.0f}% vs Local={local_data.get("lh",0)}/{local_data.get("lf",0)}={local_cov:.0f}%')

print()
print('Files in local but not CI:')
for sf in sorted(local_server):
    if sf not in ci_server:
        d = local_server[sf]
        print(f'  {sf}: {d["lh"]}/{d["lf"]}')
