#!/usr/bin/env python3
"""Fixed canonical byte vectors across the Python producer and JS parser."""
from pathlib import Path
import json,hashlib
from canonical_json import canonical_bytes,canonical_text
vectors=json.loads(Path(__file__).with_name('canonical-vectors.json').read_text())
for v in vectors['valid']:
    expected=v['expected'].encode('utf-8')
    a=canonical_text(v['input']);b=canonical_bytes(json.loads(v['input']))
    assert a==b==expected,(v,a,b)
    assert hashlib.sha256(a).digest()==hashlib.sha256(b).digest()
for raw in vectors['invalid']:
    try:canonical_text(raw)
    except ValueError:pass
    else:raise AssertionError('invalid canonical input accepted')
try:canonical_bytes(9007199254740993)
except ValueError:pass
else:raise AssertionError('Python producer rounded an integer silently')
print(f"PASS: {len(vectors['valid'])} fixed cross-language byte vectors; {len(vectors['invalid'])+1} invalid/precision cases rejected. Shared serializer, not two independent implementations.")
