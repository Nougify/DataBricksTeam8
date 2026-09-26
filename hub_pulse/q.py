#!/usr/bin/env python3
"""Run SQL (inline or @file) on the Databricks default warehouse and print a compact table."""
import json, subprocess, sys

arg = sys.argv[1]
sql = open(arg[1:]).read() if arg.startswith("@") else arg
r = subprocess.run(["databricks", "experimental", "aitools", "tools", "query", sql,
                    "--profile", "DEFAULT", "-o", "json"], capture_output=True, text=True)
out = r.stdout.strip()
try:
    rows = json.loads(out[out.find("["):]) if "[" in out else []
except json.JSONDecodeError:
    print(out, r.stderr); sys.exit(1)
if r.returncode:
    print(out, r.stderr); sys.exit(1)
if not rows:
    print("(no rows)"); sys.exit()
cols = list(rows[0].keys())
w = int(sys.argv[2]) if len(sys.argv) > 2 else 40
print(" | ".join(cols))
for row in rows:
    print(" | ".join(str(row[c])[:w] for c in cols))
