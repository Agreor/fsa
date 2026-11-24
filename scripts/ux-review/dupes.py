"""Duplicate-information finder over ux-capture text files. Usage: dupes.py OUT_DIR WIDTH"""
import json, re, sys, collections
from pathlib import Path
O, W = Path(sys.argv[1]), sys.argv[2]
def lines(p):
    t = p.read_text(errors="replace").strip()
    try: t = json.loads(t)
    except Exception: pass
    return [re.sub(r"\s+", " ", l).strip() for l in str(t).splitlines() if l.strip()]
views = {p.name[len(W)+1:-4]: lines(p) for p in sorted(O.glob(f"{W}-*.txt")) if not re.search(r"\.snap|errors|console", p.name)}
# global chrome: lines present in at least 80% of views
cnt = collections.Counter(l for v in views.values() for l in set(v))
chrome = {l for l, c in cnt.items() if c >= 0.8 * len(views)}
out = {"within_view": {}, "across_views": {}}
for name, ls in views.items():
    c = collections.Counter(l for l in ls if l not in chrome and len(l) >= 12 and not re.fullmatch(r"[\d.,\- ]+(EUR|THB)?", l))
    rep = {l: n for l, n in c.items() if n > 1}
    if rep: out["within_view"][name] = rep
for state in ("empty", "filled"):
    where = collections.defaultdict(list)
    for name, ls in views.items():
        if not name.startswith(state + "-"): continue
        for l in set(ls):
            if l not in chrome and len(l) >= 25: where[l].append(name[len(state)+1:])
    out["across_views"][state] = {l: v for l, v in where.items() if len(v) > 1}
print(json.dumps(out, indent=1, ensure_ascii=False))
