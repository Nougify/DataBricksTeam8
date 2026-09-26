#!/bin/bash
# Runs each ;-terminated statement of a .sql file on the default warehouse (profile DEFAULT)
f="$1"
python3 - "$f" <<'PY'
import sys,subprocess,re
sql=open(sys.argv[1]).read()
sql=re.sub(r'--[^\n]*','',sql)
for s in [x.strip() for x in re.split(r';\s*\n', sql+'\n') if x.strip()]:
    print('>>',s.splitlines()[0][:100],flush=True)
    r=subprocess.run(['databricks','experimental','aitools','tools','query',s,'--profile','DEFAULT'],capture_output=True,text=True)
    out=(r.stdout+r.stderr).strip()
    print(out[:1500]); 
    if r.returncode: sys.exit(1)
PY
