// Short authenticated requests follow a server-owned generation. A reload only
// disconnects this reader; the explicit AbortSignal is the sole stop action.
import { secureFetch } from './secure-session.js';

export async function durableGeneration({body, context, automatic, explicitRetry, signal, onId, fetcher=secureFetch, interval=1000}) {
  const id = crypto.randomUUID().replaceAll('-', '');
  const response = await fetcher('/api/executions', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id, request:body, context, automatic, explicitRetry}),
  });
  if (!response.ok) return response;
  onId?.(id);
  const encoder = new TextEncoder();
  let stopped = false, offset = 0, revision = 0, reasoning = 0, summary = '';
  const agentEvents=new Set();
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await fetcher(`/api/executions/${id}/stop`, {method:'POST'});
  };
  const abort = () => { stop().catch(() => {}); };
  signal?.addEventListener('abort', abort, {once:true});
  if (signal?.aborted) await stop();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = data => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      let failures = 0;
      try {
        while (!stopped) {
          let result;
          try {
            const poll = await fetcher(`/api/executions/${id}?offset=${offset}&revision=${revision}`, {cache:'no-store'});
            if (!poll.ok) throw new Error(`Lecture du suivi impossible (${poll.status}).`);
            result = await poll.json();
            failures = 0;
          } catch (error) {
            if (++failures >= 5) throw new Error('Connexion au suivi interrompue. Retrouvez l’appel dans Exécutions ; il continue sur le serveur.');
            await new Promise(resolve => setTimeout(resolve, interval));
            continue;
          }
          if (stopped) break;
          const delta = {};
          if (result.delta) delta.content = result.delta;
          offset = result.output_chars;
          revision = result.output_revision || 0;
          if (result.summary && result.summary !== summary) {
            delta.reasoning_details = [{type:'reasoning.summary', summary:result.summary.startsWith(summary) ? result.summary.slice(summary.length) : result.summary}];
            summary = result.summary;
          }
          const progress = result.reasoning_events > reasoning;
          reasoning = result.reasoning_events;
          const active = ['queued','running','connecting','waiting','reasoning','writing'].includes(result.state);
          const events=(result.agent?.events||[]).filter(event=>{const key=event.id||`${event.at}:${event.message}`;if(agentEvents.has(key))return false;agentEvents.add(key);return true;});
          emit({choices:[{delta, finish_reason:active ? null : result.finish_reason}],
            ...(result.output_reset?{bench_output_reset:true}:{}),
            ...(result.agent?{bench_agent_events:events,bench_agent_steps:result.agent.steps}:{}),
            ...(progress ? {bench_reasoning_events:reasoning} : {}),
            ...(Object.keys(result.usage || {}).length ? {usage:result.usage} : {})});
          if (!active) {
            // Let the normal output-limit handler retain its usage and precise
            // error. Other failures preserve whether any API call was sent.
            if (result.state !== 'ok' && result.finish_reason !== 'length') {
              emit({error:{message:result.error?.message || 'Exécution interrompue ; le code reçu est conservé.',
                code:result.error?.code || result.error?.status || (result.state==='cancelled' ? 'CANCELLED_BY_OPERATOR' : 'EXECUTION_INTERRUPTED'),
                requestSent:result.error?.requestSent}});
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            return;
          }
          await new Promise(resolve => setTimeout(resolve, interval));
        }
        controller.error(new DOMException('Génération arrêtée', 'AbortError'));
      } catch (error) { controller.error(error); }
      finally { signal?.removeEventListener('abort', abort); }
    },
    // Reader cancellation must never cancel the independently owned server call.
    cancel() { stopped = true; signal?.removeEventListener('abort', abort); },
  });
  return new Response(stream, {headers:{'Content-Type':'text/event-stream'}});
}
