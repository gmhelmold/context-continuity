"""Python bridge to the shared JS JCS oracle, not a second number formatter."""
from __future__ import annotations
import json, math, subprocess
from pathlib import Path
SCRIPT=Path(__file__).with_name('canonical-json.mjs')
def canonical_text(raw: str)->bytes:
    result=subprocess.run(['node',str(SCRIPT)],input=raw.encode('utf-8'),capture_output=True,timeout=10)
    if result.returncode: raise ValueError(result.stderr.decode('utf-8').strip())
    return result.stdout

def canonical_bytes(value)->bytes:
    def check(v):
        if isinstance(v,bool) or v is None or isinstance(v,str):return
        if isinstance(v,int):
            try:f=float(v)
            except OverflowError:raise ValueError('E_JSON_PRECISION')
            if not math.isfinite(f) or int(f)!=v:raise ValueError('E_JSON_PRECISION')
        elif isinstance(v,float):
            if not math.isfinite(v):raise ValueError('E_JSON_NUMBER')
        elif isinstance(v,list):
            for x in v:check(x)
        elif isinstance(v,dict):
            for k,x in v.items():
                if not isinstance(k,str):raise ValueError('E_JSON_KEY')
                check(x)
        else:raise ValueError('E_JSON_VALUE')
    check(value)
    return canonical_text(json.dumps(value,ensure_ascii=True,allow_nan=False,separators=(',',':')))
