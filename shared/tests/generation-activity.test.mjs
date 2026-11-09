import test from 'node:test';
import assert from 'node:assert/strict';
import {configureTelemetry,startGeneration} from '../services/generation-telemetry.js';

test('live activity counts reasoning signals without exposing or recording their content',()=>{
 let now=1000;
 configureTelemetry({enabled:false,now:()=>now});
 const tracker=startGeneration({app:'prompt-gallery',provider:{id:'test'},modelId:'test'});
 tracker.mark('dispatched');
 now=1200;tracker.activity('reasoning');tracker.mark('firstThought');
 now=1400;tracker.activity('reasoning');
 const state=tracker.snapshot();
 assert.equal(state.reasoningChunks,2);
 assert.equal(state.lastReceivedAt,1400);
 assert.equal(state.phases.firstThought,200);
 assert.equal(state.outputChars,0);
 tracker.finish({aborted:true});
 configureTelemetry({now:()=>Date.now()});
});
