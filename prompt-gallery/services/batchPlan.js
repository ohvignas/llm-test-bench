// Multi-model batch planning: one prompt list run by several models in a
// single launch. DOM-free so it is tested under node.
//
// Each model is a lane: its own batch run id (so Runs, Compare and the merge
// rules keep treating one run as one model) and a shared group id tying the
// lanes of one launch together. The dialog shows every lane in one flat list,
// model by model, so a lane's events are shifted by its offset in that list.

/** A model's identity for de-duplication: provider plus model id. */
export function batchModelKey(model) {
  return `${model?.providerId || ''}\u0000${model?.modelId || ''}`;
}

/** The subset of a toolbar model worth keeping in the batch list (and in localStorage). */
export function snapshotModel(model) {
  if (!model?.providerId || !model?.modelId) return null;
  const keep = ['backend', 'providerId', 'modelId', 'agentId', 'agentModelId', 'label'];
  return Object.fromEntries(keep.filter(k => model[k] != null && model[k] !== '').map(k => [k, model[k]]));
}

export const DEFAULT_LANE_MODE = 'all-parallel';
export function restoreLaneMode(value) {
  return ['all-parallel', 'parallel', 'sequential'].includes(value) ? value : DEFAULT_LANE_MODE;
}

/** Add a model to the list unless it is already there. Returns a new list. */
export function addBatchModel(list, model) {
  const snap = snapshotModel(model);
  if (!snap) return list;
  if (list.some(m => batchModelKey(m) === batchModelKey(snap))) return list;
  return [...list, snap];
}

/**
 * Lay out a launch: one lane per model, and the flat run list the dialog shows.
 * A single model keeps the plain run id, exactly as a one-model batch always has.
 *
 * @param {{ prompts: object[], models: object[], runId: string }} cfg
 */
export function planBatchLanes({ prompts, models, runId }) {
  const multi = models.length > 1;
  const lanes = models.map((model, i) => ({
    index: i,
    offset: i * prompts.length,
    prompts,
    model: {
      ...model,
      batchRunId: multi ? `${runId}-m${i + 1}` : runId,
      batchGroupId: multi ? runId : '',
    },
  }));
  const runList = lanes.flatMap(lane => prompts.map(p => ({
    ...p,
    runKey: `${lane.index}:${p.id}`,
    laneIndex: lane.index,
    modelLabel: lane.model.label || lane.model.modelId,
  })));
  return { lanes, runList, multi };
}

/** Add up the per-lane summaries from runBatch into one. */
export function combineSummaries(summaries) {
  const out = { lanes: summaries.length, stopped: false };
  for (const s of summaries) {
    for (const [key, value] of Object.entries(s || {})) {
      if (key === 'stopped') out.stopped = out.stopped || !!value;
      else if (typeof value === 'number') out[key] = (out[key] ?? 0) + value;
      else if (value === null && !(key in out)) out[key] = null;
    }
  }
  return out;
}

/**
 * 'all-parallel' starts every prompt/model pair independently. 'parallel'
 * starts the models together but keeps each model's prompts sequential.
 * 'sequential' runs both in order. A user stop affects all work; a failure
 * affects only its task (one prompt in all-parallel, one lane otherwise).
 * Resolves to the lanes' results in lane order.
 */
export async function runLanes({ lanes, mode = 'parallel', runOne, shouldStop = () => false, stopOnFailure = false, onFailure = () => {} }) {
  const run = async lane => {
    if (shouldStop()) return null;
    let failed = false;
    const fail = () => {
      if (!stopOnFailure || failed) return;
      failed = true;
      onFailure(lane);
    };
    try {
      const result = await runOne(lane, { shouldStop: () => failed || shouldStop(), onFailure: fail });
      if (result?.failed > 0) fail();
      return result;
    } catch (error) {
      fail();
      throw error;
    }
  };
  if (mode === 'all-parallel') {
    // Preserve each model's run id and the flat list's absolute offsets. Each
    // task owns its failure gate, costs, output and pause boundary. Group the
    // results back by model so the summary still counts models, not tasks.
    return Promise.all(lanes.map(async lane => {
      const results = await Promise.all(lane.prompts.map((prompt, index) =>
        run({...lane, offset:lane.offset + index, prompts:[prompt]})));
      const {lanes: _count, ...summary} = combineSummaries(results);
      return summary;
    }));
  }
  if (mode === 'parallel') return Promise.all(lanes.map(run));
  const results = [];
  for (const lane of lanes) {
    if (shouldStop()) break;
    results.push(await run(lane));
  }
  return results;
}
