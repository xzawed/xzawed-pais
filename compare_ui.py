def get_coverage_by_file(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        content = f.read()
    sections = content.split('end_of_record')
    result = {}
    for s in sections:
        sf = None
        lh = 0
        lf = 0
        uncovered = []
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

print('=== UI Coverage Comparison ===')
ci = get_coverage_by_file('f:/tmp/ci_orc/ui/coverage/lcov.info')
local = get_coverage_by_file('xzawedOrchestrator/packages/ui/coverage/lcov.info')
print(f'CI: {len(ci)} files, Local: {len(local)} files')

# All files
for sf in sorted(set(list(ci.keys()) + list(local.keys()))):
    ci_d = ci.get(sf, {'lh': 0, 'lf': 0, 'uncovered': []})
    local_d = local.get(sf, {'lh': 0, 'lf': 0, 'uncovered': []})
    ci_cov = ci_d['lh'] / ci_d['lf'] * 100 if ci_d['lf'] else 0
    local_cov = local_d['lh'] / local_d['lf'] * 100 if local_d['lf'] else 0
    status = 'SAME' if abs(ci_cov - local_cov) < 3 else 'DIFF'
    loc = 'BOTH' if sf in ci and sf in local else ('CI_ONLY' if sf in ci else 'LOCAL_ONLY')
    print(f'  [{status}/{loc}] {sf}: CI={ci_d["lh"]}/{ci_d["lf"]}={ci_cov:.0f}% vs Local={local_d["lh"]}/{local_d["lf"]}={local_cov:.0f}%')

# Total
ci_total_lh = sum(d['lh'] for d in ci.values())
ci_total_lf = sum(d['lf'] for d in ci.values())
local_total_lh = sum(d['lh'] for d in local.values())
local_total_lf = sum(d['lf'] for d in local.values())
print(f'\nCI Total: {ci_total_lh}/{ci_total_lf} = {100*ci_total_lh/ci_total_lf:.1f}%' if ci_total_lf else 'CI: empty')
print(f'Local Total: {local_total_lh}/{local_total_lf} = {100*local_total_lh/local_total_lf:.1f}%' if local_total_lf else 'Local: empty')
