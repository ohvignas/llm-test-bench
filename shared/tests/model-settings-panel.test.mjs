import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeOpenRouterModel, resolveModelSettings} from '../services/model-capabilities.js';
import {planBatchLanes} from '../../prompt-gallery/services/batchPlan.js';
import {runBatch} from '../../prompt-gallery/services/batchRunner.js';

// Render the actual template into plain virtual nodes: only its browser import
// map is replaced, so handlers and model payloads are the production code.
const source = await readFile(new URL('../../prompt-gallery/components/ModelSettingsPanel.js', import.meta.url), 'utf8');
const htmUrl = new URL('../lib/htm/3.1.1/htm.mjs', import.meta.url).href;
const moduleSource = source.replace("import {html} from 'htm/preact';", `import htm from ${JSON.stringify(htmUrl)}; const html=htm.bind((type,props,...children)=>({type,props,children}));`);
const {ModelSettingsPanel} = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== 'object') return [];
  return [node,...descendants(node.children || [])];
}

test('typing a per-model budget commits on input before blur and reaches both batch lanes unchanged', async () => {
  const models = ['one','two'].map(id => ({providerId:'openrouter',modelId:id,label:id}));
  const api = normalizeOpenRouterModel({id:'fixture',supported_parameters:['max_tokens','reasoning'],top_provider:{max_completion_tokens:65536},reasoning:{mandatory:true,supported_efforts:['high','low']}});
  const settings = resolveModelSettings({model:api});
  const overrides = new Map();
  const tree = ModelSettingsPanel({reports:models.map(model => ({model,isOpenRouter:true,settings})),onOverride:(model,patch) => overrides.set(model.modelId,patch)});
  const inputs = descendants(tree).filter(node => node.type === 'input' && node.props?.type === 'number');
  assert.equal(inputs.length,2);
  for (const input of inputs) {
    assert.equal(typeof input.props.onInput,'function','A fill/input event must commit without waiting for blur or change');
    input.props.onInput({target:{value:'12288'}});
  }
  const configured = models.map(model => {
    const override = overrides.get(model.modelId);
    assert.equal(override.totalTokens,12288);
    assert.equal(override.profile,'manual');
    const generationOptions={profile:'code',...override,budget:{totalTokens:32768,...override}};
    return {...model,generationOptions:{...generationOptions,reviewedMaxTokens:resolveModelSettings({model:api,...generationOptions}).params.max_tokens}};
  });
  const {lanes} = planBatchLanes({prompts:[{id:'test',title:'Test',prompt:'Create HTML'}],models:configured,runId:'test'});
  const sent = [];
  await Promise.all(lanes.map(lane => runBatch({prompts:lane.prompts,model:lane.model,options:{progressive:false},deps:{
    generate:async (_prompt,{model}) => {sent.push(resolveModelSettings({model:api,...model.generationOptions}).params.max_tokens);return '<html>ok</html>';},
    save:async () => ({id:'saved'}),
  }})));
  assert.deepEqual(sent,[12288,12288]);
});

test('an intermediate empty or invalid number does not erase the last confirmed per-model budget', () => {
  const api = normalizeOpenRouterModel({id:'fixture',supported_parameters:['max_tokens'],top_provider:{max_completion_tokens:65536}});
  const patches=[];
  const tree=ModelSettingsPanel({reports:[{model:{providerId:'openrouter',modelId:'fixture'},isOpenRouter:true,settings:resolveModelSettings({model:api})}],onOverride:(_model,patch)=>patches.push(patch)});
  const input=descendants(tree).find(node=>node.type==='input');
  for(const value of ['', '-1', '1.5', 'garbage']) input.props.onInput({target:{value}});
  assert.deepEqual(patches,[]);
});
