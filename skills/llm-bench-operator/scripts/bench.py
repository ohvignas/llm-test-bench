#!/usr/bin/env python3
"""Find the installed Bench checkout and delegate without a shell or credentials."""
import json
import os
from pathlib import Path
import subprocess
import sys

skill = Path(__file__).resolve().parent.parent
candidates = [Path(os.environ['BENCH_REPO'])] if os.environ.get('BENCH_REPO') else []
config = skill/'local.json'
if config.exists():
    value = json.loads(config.read_text()).get('repo')
    if isinstance(value, str): candidates.append(Path(value))
candidates += list(skill.parents)
repo = next((p for p in candidates if (p/'benchctl').is_file() and (p/'server/control.py').is_file()), None)
if repo is None:
    raise SystemExit('Définir BENCH_REPO vers le dépôt llm-test-bench, ou réinstaller le skill avec ./benchctl install-skill.')
raise SystemExit(subprocess.call([sys.executable, str(repo/'benchctl'), *sys.argv[1:]], cwd=repo))
