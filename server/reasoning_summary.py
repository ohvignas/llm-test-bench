"""Only provider-designated summaries, never encrypted or generic raw reasoning.

OpenRouter defaults modern Claude's thinking.display to summarized, including
when its compatibility API uses reasoning.text or the legacy reasoning alias.
https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#summarized-thinking
Keep this allowlist explicit: other providers' reasoning.text is not a summary.
"""
import re

SUMMARIZED_CLAUDE = re.compile(r'^anthropic/claude-(?:fable-5(?:\.[12])?|mythos-5(?:\.[12])?|opus-(?:5(?:\.5)?|4\.[78])|sonnet-5(?:\.5)?|haiku-5\.5)(?::[a-z-]+)?$')


def public_summary_parts(delta, model):
    if not isinstance(delta, dict):
        return []
    details = [p for p in delta.get('reasoning_details') or [] if isinstance(p, dict)]
    explicit = [p['summary'] for p in details if p.get('type') == 'reasoning.summary' and isinstance(p.get('summary'), str)]
    if explicit:
        return explicit
    if not SUMMARIZED_CLAUDE.fullmatch(model):
        return []
    summarized = [p['text'] for p in details if p.get('type') == 'reasoning.text'
                  and p.get('format') == 'anthropic-claude-v1' and isinstance(p.get('text'), str)]
    if summarized:
        return summarized
    # No generic fallback when typed data exists: encrypted or unknown blocks
    # must not be reclassified through a legacy alias.
    if not details and isinstance(delta.get('reasoning'), str):
        return [delta['reasoning']]
    return []
