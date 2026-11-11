import {logModelKey} from './batchGenerationLog.js';
import {safeSummaryText, REASONING_SUMMARY_LIMIT} from '../../shared/services/reasoning-summary.js';

export function batchActivity({model, index, calls = [], liveCalls = [], entries = []}) {
  const latest = [...calls].sort((a,b) => b.startedAt - a.startedAt)[0];
  const live = latest?.telemetryId ? liveCalls.find(call => call.id === latest.telemetryId
    && call.app === 'prompt-gallery' && logModelKey(call) === logModelKey(model)) : null;
  const summary = latest?.reasoningSummary?.source === 'provider-summary' ? latest.reasoningSummary : null;
  return {
    live,
    text: summary ? safeSummaryText(String(summary.text || '').slice(0, REASONING_SUMMARY_LIMIT)) : '',
    truncated: !!summary?.truncated,
    signals: live?.reasoningChunks ?? latest?.reasoningSignals ?? null,
    entries: entries.filter(entry => entry.promptIndex === index && entry.modelKey === logModelKey(model)).slice(-6).reverse(),
  };
}
