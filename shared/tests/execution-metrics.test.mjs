import test from 'node:test';
import assert from 'node:assert/strict';
import {executionMetrics,formatDuration} from '../../prompt-gallery/services/executionMetrics.js';
import {buildRuns} from '../../prompt-gallery/services/runs.js';
const a={id:'a',modelLabel:'A',status:'done',startedAt:1000,finishedAt:5000};
const b={id:'b',modelLabel:'B',status:'done',startedAt:2000,finishedAt:6000};
test('parallel calls use wall time and separate per-model counts',()=>{
 const result=executionMetrics([a,b]);
 assert.equal(result.elapsedMs,5000);assert.equal(result.requestCount,2);
 assert.deepEqual(result.models.map(m=>[m.label,m.elapsedMs,m.requestCount]),[['A',4000,1],['B',4000,1]]);
});
test('live duration advances and completed durations remain frozen',()=>{
 const pending={...a,status:'pending',finishedAt:undefined};
 assert.equal(executionMetrics([pending],{now:4000,done:false}).elapsedMs,3000);
 assert.equal(executionMetrics([pending],{now:9000,done:false}).elapsedMs,8000);
 assert.equal(executionMetrics([a],{now:900000}).elapsedMs,4000);
 assert.equal(executionMetrics([pending]).elapsedMs,null);
});
test('full batch wall time includes pauses and checking without adding concurrent calls',()=>{
 assert.equal(executionMetrics([a,b],{startedAt:0,finishedAt:11000}).elapsedMs,11000);
 assert.equal(executionMetrics([a,b],{startedAt:0,now:15000,done:false}).elapsedMs,15000);
});
test('stream updates and checkpoint duplicates count once; blocked attempts do not count',()=>{
 const blocked={id:'blocked',status:'blocked',requestSent:false,startedAt:0,finishedAt:90000};
 const result=executionMetrics([{...a,status:'pending',finishedAt:undefined},a,{...b,status:'error'},blocked]);
 assert.equal(result.requestCount,2);assert.equal(result.blockedCalls,1);assert.equal(result.elapsedMs,5000);
 assert.equal(executionMetrics([blocked]).elapsedMs,0);
});
test('old or malformed timing remains unknown rather than pretending it took zero seconds',()=>{
 for(const call of [{id:'old'}, {...a,finishedAt:999}, {...a,startedAt:null}]) assert.equal(executionMetrics([call]).elapsedMs,null);
 assert.equal(formatDuration(null),'Non mesurée');
 assert.equal(formatDuration(0),'0 s');assert.equal(formatDuration(90000),'1 min 30 s');
 assert.equal(formatDuration(3661999),'1 h 1 min 1 s');
});
test('historical multi-stage results deduplicate cumulative call snapshots',()=>{
 const generations=[{id:'step1',metadata:{batch:{id:'run'},billing:{calls:[a]}}},
  {id:'step2',metadata:{batch:{id:'run'},billing:{calls:[a,b]}}}];
 const run=buildRuns(generations)[0];
 assert.equal(run.billing.requestCount,2);assert.equal(run.billingComplete,true);
 assert.equal(executionMetrics(run.billing.calls).elapsedMs,5000);
 assert.equal(buildRuns([{id:'old',metadata:{batch:{id:'old'}}}])[0].billingComplete,false);
});
