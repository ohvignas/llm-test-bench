import test from 'node:test';
import assert from 'node:assert/strict';
import {createBatchJournal, generationActivity, logModelKey} from '../../prompt-gallery/services/batchGenerationLog.js';
const model={providerId:'router',modelId:'claude',label:'Claude de test'};
const call={id:'call-1',app:'prompt-gallery',...model,startedAt:1000,phase:'firstThought',phases:{queued:0,dispatched:10,sessionReady:100,firstThought:200},lastActivityAt:1200,lastReceivedAt:1200,reasoningChunks:1,outputChars:0};

test('the journal reconstructs observed phases without keeping private reasoning or request bodies',()=>{
 const journal=createBatchJournal({models:[model],startedAt:1000});
 journal.observeCalls([{...call,reasoning:'PRIVATE THOUGHT',request:{key:'SECRET KEY'}}],1500);
 const rows=journal.entries();
 assert.ok(rows.some(r=>r.message.includes('Requête envoyée')));
 assert.ok(rows.some(r=>r.message.includes('Raisonnement signalé')));
 assert.equal(rows.find(r=>r.stage==='firstThought').at,1200);
 assert.doesNotMatch(JSON.stringify(rows),/PRIVATE THOUGHT|SECRET KEY/);
 const count=rows.length;
 journal.observeCalls([call],1600);
 assert.equal(journal.entries().length,count);
});
test('only calls belonging to the launched provider/model and time window are shown',()=>{
 const journal=createBatchJournal({models:[model],startedAt:1000});
 journal.observeCalls([{...call,app:'other'},{...call,providerId:'other'},{...call,startedAt:1}],2000);
 assert.equal(journal.entries().length,0);
});
test('silence is reported as unconfirmed waiting and recovery is logged once',()=>{
 const journal=createBatchJournal({models:[model],startedAt:1000});
 journal.observeCalls([call],70000);
 assert.equal(journal.entries().filter(r=>r.stage==='silence').length,1);
 assert.match(generationActivity(call,70000).label,/signal|silence/i);
 assert.equal(generationActivity(call,70000).stalled,true);
 journal.observeCalls([call],71000);
 assert.equal(journal.entries().filter(r=>r.stage==='silence').length,1);
 journal.observeCalls([{...call,lastReceivedAt:72000,lastActivityAt:72000}],72500);
 assert.equal(journal.entries().filter(r=>r.stage==='resumed').length,1);
});
test('HTML is summarized and each model retains a separate bounded history',()=>{
 const journal=createBatchJournal({models:[model],startedAt:1000,limit:5});
 for(let i=0;i<10;i++) journal.event({type:'log',message:'étape '+i},{model,index:0,title:'Page de test'},2000+i);
 assert.equal(journal.entries().length,5);
 assert.equal(journal.entries().at(-1).modelKey,logModelKey(model));
 journal.event({type:'chunk',html:'<html>DO NOT COPY THE PAGE</html>'},{model,index:0,title:'test'},5000);
 assert.doesNotMatch(JSON.stringify(journal.entries()),/DO NOT COPY THE PAGE/);
});
test('provider error credentials are redacted before displaying or exporting them',()=>{
 const journal=createBatchJournal({models:[model],startedAt:1000});
 journal.event({type:'item',status:'error',message:'bad sk-or-v1-secret12345 Bearer token-secret api_key=anothersecret'},{model,title:'test'},2000);
 const text=JSON.stringify(journal.entries());
 assert.doesNotMatch(text,/sk-or-v1-secret12345|token-secret|anothersecret/);
 assert.equal(journal.entries().at(-1).level,'error');
});
test('final usage includes reported reasoning, token limit and cost even without HTML',()=>{
 const journal=createBatchJournal({models:[model],startedAt:1000});
 journal.event({type:'stats',stats:{completionTokens:65536,reasoningTokens:65536,cost:1.25,finishReason:'length'}},{model,title:'test'},2000);
 assert.match(journal.entries().at(-1).message,/65536/);
 assert.match(journal.entries().at(-1).message,/1.25/);
 assert.match(journal.entries().at(-1).message,/limite|budget/);
});

test('unchanged counters never create fake progress events while the provider stays silent',()=>{
 const journal=createBatchJournal({models:[model],startedAt:1000});
 journal.observeCalls([call],2000);
 const before=journal.entries().filter(e=>e.stage==='progress').length;
 journal.observeCalls([call],12000);
 assert.equal(journal.entries().filter(e=>e.stage==='progress').length,before);
});
