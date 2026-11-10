"""Local, observable generation policy, separate from provider capabilities."""
import json
from pathlib import Path
from flask import current_app
from .storage import db

EFFORTS = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none']


def policies():
    result = {}
    # Existing telemetry also covers requests sent before server live tracking.
    directory = Path(current_app.config['DATA_DIR'])/'files/_telemetry/generations'
    for path in sorted(directory.glob('*.jsonl'))[-30:]:
        for line in path.read_text().splitlines():
            try:
                row = json.loads(line)
                if row.get('finishReason') == 'length' and row.get('responseChars') == 0 and row.get('modelId'):
                    result[row['modelId']] = {'recovery_level': 2, 'reason': 'Sortie épuisée sans code observée précédemment : démarrage avec un effort réduit.'}
            except (ValueError, AttributeError):
                continue
    for row in db().execute("SELECT model FROM generation_activity WHERE finish_reason='length' AND output_chars=0"):
        result[row['model']] = {'recovery_level': 2, 'reason': 'Sortie épuisée sans code observée précédemment : démarrage avec un effort réduit.'}
    for row in db().execute('SELECT model, effort, max_tokens FROM model_policies'):
        result.setdefault(row['model'], {}).update({'effort': row['effort'], 'max_tokens': row['max_tokens']})
    return result


def settings(model, *, max_tokens=None, effort=None, recovery=0, policy=None):
    supported = model.get('supported_parameters') or []
    limits = model.get('top_provider') or {}
    maximum = limits.get('max_completion_tokens')
    context = limits.get('context_length') or model.get('context_length')
    if not isinstance(context, int) or context <= 0:
        raise ValueError('Limite de contexte absente du catalogue API.')
    if not isinstance(maximum, int) or maximum <= 0:
        raise ValueError('Limite de sortie absente du catalogue API.')
    policy = policy or {}
    total = max_tokens if max_tokens is not None else policy.get('max_tokens') or maximum
    if not isinstance(total, int) or not 256 <= total <= maximum:
        raise ValueError('La sortie doit être comprise entre 256 et la limite API.')
    key = 'max_tokens' if 'max_tokens' in supported else 'max_completion_tokens'
    if key not in supported:
        raise ValueError('Ce modèle ne permet pas de contrôler sa sortie.')
    params = {key: total, 'provider': {'require_parameters': True}}
    reasoning = model.get('reasoning') or {}
    choices = reasoning.get('supported_efforts')
    choices = EFFORTS if choices is None and 'supported_efforts' in reasoning else choices or []
    enabled = [x for x in EFFORTS if x in choices and x != 'none']
    level = max(recovery, policy.get('recovery_level', 0))
    requested = effort or policy.get('effort')
    if requested and requested not in choices:
        raise ValueError('Effort non accepté par le catalogue API : ' + requested)
    if reasoning.get('mandatory') and requested == 'none':
        raise ValueError('Le raisonnement est obligatoire pour ce modèle.')
    if reasoning.get('supports_max_tokens') and not requested:
        params['reasoning'] = {'max_tokens': min(4096 if level else 16384, total//3)}
    elif enabled:
        chosen = requested if not recovery else None
        chosen = chosen or (enabled[-1] if level >= 2 else 'medium' if level == 1 and 'medium' in enabled else 'high' if 'high' in enabled else enabled[0])
        if 'reasoning' in supported:
            params['reasoning'] = {'effort': chosen}
        elif 'reasoning_effort' in supported:
            params['reasoning_effort'] = chosen
    return params, context
