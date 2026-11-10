"""Numeric server-side diagnostics. Never retain prompts, output or reasoning text."""
import json
import math
import os
import re
import time
import uuid

from .storage import db
from .spend_guard import process_marker


def safe_label(value):
    text = str(value or '')[:160]
    return re.sub(r'(?i)sk-[a-z0-9_-]+', '[masqué]', text)


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


class Activity:
    def __init__(self, payload, automatic=None):
        self.id = uuid.uuid4().hex
        self.started = time.time()
        self.last_flush = 0
        self.last_cancel_check = 0
        self.cancel_requested = False
        self.output_chars = self.reasoning_events = 0
        self.reason = None
        self.usage = {}
        self.state = 'connecting'
        reasoning = payload.get('reasoning') or {}
        effort = reasoning.get('effort') if isinstance(reasoning, dict) else None
        settings = {'max_tokens': number(payload.get('max_tokens', payload.get('max_completion_tokens'))),
                    'reasoning_effort': effort if effort in ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max') else None,
                    'reasoning_tokens': number(reasoning.get('max_tokens')) if isinstance(reasoning, dict) else None,
                    'automatic': bool(automatic)}
        connection = db()
        connection.execute('DELETE FROM generation_activity WHERE started < ? AND state NOT IN (?,?,?,?)',
                           (self.started - 30*86400, 'connecting', 'waiting', 'reasoning', 'writing'))
        connection.execute('INSERT INTO generation_activity (id,model,worker,started,updated,state,settings) VALUES (?,?,?,?,?,?,?)',
                           (self.id, safe_label(payload.get('model')), f'pending:{os.getpid()}:{process_marker(os.getpid())}',
                            self.started, self.started, self.state, json.dumps(settings)))
        connection.commit()

    def observe(self, event):
        if not isinstance(event, dict):
            return
        for choice in event.get('choices') or []:
            if not isinstance(choice, dict):
                continue
            delta = choice.get('delta') or choice.get('message') or {}
            if isinstance(delta, dict):
                content = delta.get('content')
                if isinstance(content, str):
                    self.output_chars += len(content)
                if delta.get('reasoning') or delta.get('reasoning_content') or delta.get('reasoning_details'):
                    self.reasoning_events += 1
            reason = choice.get('finish_reason')
            if reason in ('stop', 'length', 'tool_calls', 'content_filter', 'error'):
                self.reason = reason
        usage = event.get('usage')
        if isinstance(usage, dict):
            for key in ('prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'):
                if number(usage.get(key)) is not None:
                    self.usage[key] = usage[key]
            details = usage.get('completion_tokens_details')
            if isinstance(details, dict) and number(details.get('reasoning_tokens')) is not None:
                self.usage['reasoning_tokens'] = details['reasoning_tokens']
        self.state = 'writing' if self.output_chars else 'reasoning' if self.reasoning_events else 'waiting'
        self.flush()

    def flush(self, force=False):
        now = time.time()
        if not force and now - self.last_flush < 2:
            return
        self.last_flush = now
        connection = db()
        connection.execute('UPDATE generation_activity SET updated=?,state=?,output_chars=?,reasoning_events=?,finish_reason=?,usage=? WHERE id=?',
                           (now, self.state, self.output_chars, self.reasoning_events, self.reason, json.dumps(self.usage), self.id))
        connection.commit()

    def cancelled(self):
        now = time.time()
        if now - self.last_cancel_check < 2:
            return self.cancel_requested
        self.last_cancel_check = now
        row = db().execute('SELECT cancel_requested FROM generation_activity WHERE id=?', (self.id,)).fetchone()
        self.cancel_requested = bool(row and row[0])
        return self.cancel_requested

    def finish(self, state):
        self.state = state
        self.flush(force=True)
