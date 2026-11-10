"""Reviewed recovery settings: metadata requests are free; never launch a model.

Only a recorded output-limit failure can propose less thinking. Keep the total
output ceiling, never disable mandatory reasoning, and never invent abilities
from a model's name. The confirmed request must match the displayed proposal.
"""
from copy import deepcopy
import threading
import time

from flask import abort, current_app
import requests

from .model_policy import EFFORTS
from .proxy import UPSTREAM

_LOCK = threading.Lock()


def unavailable(reason):
    return {'available':False,'reason':reason}


def propose_recovery(payload, info, model):
    if info.get('finish_reason') != 'length':
        return None
    supported = model.get('supported_parameters') or []
    key = next((key for key in ('max_tokens','max_completion_tokens') if key in payload and key in supported),None)
    total = payload.get(key) if key else None
    maximum = (model.get('top_provider') or {}).get('max_completion_tokens')
    if type(total) is not int or type(maximum) is not int or min(total,maximum)<=0:
        return unavailable('Capacités API incomplètes : aucun réglage adapté ne peut être proposé. Les réglages d’origine peuvent reproduire cet échec.')
    total = min(total,maximum)
    reasoning = model.get('reasoning') or {}
    original = payload.get('reasoning') or {}
    extras = {key:value for key,value in original.items() if key not in ('effort','max_tokens','enabled')}
    params = {key:total}
    fixed = original.get('max_tokens')
    if type(fixed) is int and reasoning.get('supports_max_tokens') and 'reasoning' in supported:
        budget = min(4096,total//4,fixed//2)
        if budget<1024:
            return unavailable('Le budget de réflexion est déjà trop bas pour proposer une réduction sûre. Une construction par étapes est nécessaire.')
        params['reasoning'] = {**extras,'max_tokens':budget}
        detail = f'Budget de réflexion réduit de {fixed} à {budget} tokens.'
    else:
        choices = reasoning.get('supported_efforts')
        choices = EFFORTS if choices is None and 'supported_efforts' in reasoning else choices or []
        enabled = [effort for effort in EFFORTS if effort in choices and effort!='none']
        previous = original.get('effort') or payload.get('reasoning_effort')
        if previous not in enabled:
            return unavailable('Aucun effort de remplacement vérifié par l’API. Les réglages d’origine peuvent reproduire cet échec.')
        lower = enabled[enabled.index(previous)+1:]
        if not lower:
            return unavailable('L’effort est déjà au minimum accepté. Réduisez la portée du prompt ou construisez le projet par étapes avant de relancer.')
        chosen = 'high' if previous in ('max','xhigh') and 'high' in lower else lower[0]
        if 'reasoning' in supported:
            params['reasoning'] = {**extras,'effort':chosen}
        elif 'reasoning_effort' in supported:
            params['reasoning_effort'] = chosen
        else:
            return unavailable('Le catalogue n’annonce aucun contrôle de l’effort pour ce modèle.')
        detail = f'Effort réduit de « {previous} » à « {chosen} » après épuisement de la sortie.'
    return {'available':True,'parameters':params,'reason':detail+' Le plafond total reste élevé ; une réussite n’est pas garantie.'}


def recovery_adaptation(payload, info):
    if info.get('finish_reason') != 'length':
        return None
    try:
        with _LOCK:
            cache = current_app.extensions.get('recovery_capabilities')
            if not cache or time.monotonic()-cache['at']>60:
                response = requests.get(UPSTREAM+'/models',timeout=(3,10),allow_redirects=False)
                response.raise_for_status()
                models = response.json()['data']
                cache = {'at':time.monotonic(),'models':{m['id']:m for m in models if isinstance(m,dict) and isinstance(m.get('id'),str)}}
                current_app.extensions['recovery_capabilities'] = cache
        return propose_recovery(payload,info,cache['models'].get(payload['model'],{}))
    except (requests.RequestException,ValueError,TypeError,KeyError):
        return unavailable('Catalogue API indisponible : les réglages adaptés ne sont pas vérifiables. Aucun appel de génération n’a été lancé.')


def reviewed_recovery(payload, info, body):
    strategy = body.get('strategy','original')
    if strategy == 'original':
        return payload
    if strategy != 'adapted':
        abort(400,description='Stratégie de reprise inconnue.')
    adaptation = recovery_adaptation(payload,info)
    if (not adaptation or not adaptation['available']
            or body.get('expected_parameters') != adaptation['parameters']):
        abort(409,description='Les réglages adaptés ne correspondent plus à la proposition. Rouvrez la reprise ; aucun appel envoyé.')
    result = deepcopy(payload)
    for key in ('max_tokens','max_completion_tokens','reasoning','reasoning_effort'):
        result.pop(key,None)
    result.update(adaptation['parameters'])
    return result
