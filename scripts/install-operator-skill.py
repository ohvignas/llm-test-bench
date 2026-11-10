#!/usr/bin/env python3
"""Install the reusable operator skill, with a local checkout locator."""
import argparse
import json
import os
from pathlib import Path
import shutil

repo = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description='Installer le skill Codex llm-bench-operator pour ce dépôt.')
parser.add_argument('--destination', type=Path, default=Path(os.environ.get('CODEX_HOME',str(Path.home()/'.codex')))/'skills/llm-bench-operator')
args = parser.parse_args()
source = repo/'skills/llm-bench-operator'
destination = args.destination.expanduser().absolute()
if destination.is_symlink(): raise SystemExit('La destination ne doit pas être un lien symbolique.')
if destination.exists() and not (destination/'local.json').exists():
    raise SystemExit('Destination existante sans marqueur d’installation ; choisir un autre dossier.')
shutil.copytree(source, destination, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__','local.json'))
local=destination/'local.json'
local.write_text(json.dumps({'repo':str(repo)},ensure_ascii=False,indent=2)+'\n');local.chmod(0o600)
print('Skill installé : '+str(destination))
print('Invocation : $llm-bench-operator. Ouvrir un nouveau chat si la liste des skills n’est pas actualisée.')
