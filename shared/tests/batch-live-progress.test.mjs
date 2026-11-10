import test from 'node:test';
import assert from 'node:assert/strict';
import {batchLiveStatus, batchItemRunning} from '../../prompt-gallery/services/batchLiveProgress.js';

const model={providerId:'openrouter',modelId:'dummy/model'};
const call={...model,app:'prompt-gallery',phase:'firstThought',startedAt:1000,outputChars:0};

test('a reasoning-only response is shown as reasoning with a moving elapsed time',()=>{
  assert.deepEqual(batchLiveStatus([call],model,66000),{
    label:'Raisonnement en cours',elapsed:'1 min 5 s',outputChars:0,
  });
  assert.equal(batchLiveStatus([call],model,67000).elapsed,'1 min 6 s');
});

test('parallel model statuses never borrow progress from another provider or app',()=>{
  assert.equal(batchLiveStatus([call],{...model,modelId:'other'},66000),null);
  assert.equal(batchLiveStatus([{...call,providerId:'other'}],model,66000),null);
  assert.equal(batchLiveStatus([{...call,app:'another-app'}],model,66000),null);
});

test('received answer text remains distinct from HTML accepted by the preview',()=>{
  const status=batchLiveStatus([{...call,phase:'firstToken',outputChars:150}],model,5000);
  assert.equal(status.label,'Réception de la réponse');
  assert.equal(status.outputChars,150);
  assert.equal(status.elapsed,'4 s');
});

test('every parallel running lane can be inspected before it produces HTML',()=>{
  const items=[{status:'generating'},{status:'generating'},{status:'generating'}];
  assert.deepEqual(items.map(batchItemRunning),[true,true,true]);
  assert.equal(batchItemRunning({status:'queued'}),false);
  assert.equal(batchItemRunning({status:'saved'}),false);
});

test('concurrent projects of the same model keep separate progress, including a queued project', () => {
  const calls = [{...call, id:'game'}, {...call, id:'site', startedAt:2000, phase:'firstToken', outputChars:150}];
  assert.equal(batchLiveStatus(calls, model, 6000, ['game']).label, 'Raisonnement en cours');
  assert.equal(batchLiveStatus(calls, model, 6000, ['site']).outputChars, 150);
  assert.equal(batchLiveStatus(calls, model, 6000, []), null);
});
