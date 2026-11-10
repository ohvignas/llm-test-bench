import {batchItemRunning} from './batchLiveProgress.js';

// Keep one pane per model. Follow that lane's current prompt independently;
// pinning a prompt instead aligns all panes, even before a model has reached it.
export function liveComparisonCards({models = [], runList = [], items = [], outputs = [], calls = [], promptId = ''}) {
  return models.map((model, laneIndex) => {
    const indices = runList.flatMap((prompt, index) => (prompt.laneIndex ?? 0) === laneIndex ? [index] : []);
    const selected = promptId ? indices.find(index => runList[index].id === promptId)
      : indices.find(index => batchItemRunning(items[index]))
        ?? indices.findLast(index => items[index]?.status && !['queued', 'not-started'].includes(items[index].status))
        ?? indices[0];
    const index = selected ?? -1;
    return {model, laneIndex, index, prompt:runList[index], item:items[index] || {status:'queued'},
      output:outputs[index] || '', calls:calls.filter(call => call.index === index)};
  });
}

export function liveComparisonPrompts(runList = []) {
  return [...new Map(runList.map(prompt => [prompt.id, {id:prompt.id, title:prompt.title}])).values()];
}
