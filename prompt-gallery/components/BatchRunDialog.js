import { html } from 'htm/preact';
import { Fragment } from 'preact';
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';
import { ExecutorModelSelector } from '../../shared/components/ExecutorModelSelector.js';
import { CellEditor } from '../../shared/components/CellEditor.js';
import { BatchCosts } from './BatchCosts.js';
import { costTotals, formatUsd } from '../services/batchCosts.js';
import { BatchGenerationLog } from './BatchGenerationLog.js';
import { createBatchJournal, logModelKey, safeLogText } from '../services/batchGenerationLog.js';
import { HtmlLightbox } from './BatchReview.js';
import { DEFAULT_HTML_BUDGET } from '../services/generationBudget.js';
import {resolveModelSettings} from '../../shared/services/model-capabilities.js';
import {ModelSettingsPanel} from './ModelSettingsPanel.js';
import { batchPromptChoices } from '../services/batchPromptSearch.js';
import { runBatch } from '../services/batchRunner.js';
import { getInFlight, subscribeInFlight } from '../../shared/services/generation-telemetry.js';
import { batchLiveStatus, batchItemRunning } from '../services/batchLiveProgress.js';
import { PROMPT_SETS, promptSetOf } from '../services/library.js';
import {
  addBatchModel,
  batchModelKey,
  combineSummaries,
  planBatchLanes,
  runLanes,
  snapshotModel,
} from '../services/batchPlan.js';

// The multi-model list and lane mode outlive the dialog, so a rerun of the same
// comparison is one click.
const MODELS_KEY = 'prompt-gallery-batch-models';
const LANE_MODE_KEY = 'prompt-gallery-batch-lane-mode';
const SETTINGS_KEY = 'prompt-gallery-model-adaptation-v1';

function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* optional */ }
}
import {
  completionTokenCount,
  estimatedTokenCount,
  formatTokensPerSecond,
  tokensPerSecond,
} from '../services/batchMetrics.js';

const STATUS_META = {
  queued:     { icon: 'fa-regular fa-circle',        cls: 'queued',  label: 'En attente' },
  planning:   { icon: 'fa-solid fa-list-check',      cls: 'active',  label: 'Planification' },
  generating: { icon: 'fa-solid fa-bolt',            cls: 'active',  label: 'Génération' },
  checking:   { icon: 'fa-solid fa-flask',           cls: 'active',  label: 'Vérification' },
  healing:    { icon: 'fa-solid fa-screwdriver-wrench', cls: 'active', label: 'Correction' },
  auditing:   { icon: 'fa-solid fa-magnifying-glass-chart', cls: 'active', label: 'Audit' },
  repairing:  { icon: 'fa-solid fa-screwdriver-wrench', cls: 'active', label: 'Réparation' },
  verified:   { icon: 'fa-solid fa-circle-check',    cls: 'ok',      label: 'Vérifié' },
  warned:     { icon: 'fa-solid fa-circle-question', cls: 'warn',    label: 'À vérifier' },
  no_progress:{ icon: 'fa-solid fa-equals',          cls: 'warn',    label: 'Aucun progrès' },
  saved:      { icon: 'fa-solid fa-circle-check',    cls: 'ok',      label: 'Enregistré' },
  skipped:    { icon: 'fa-solid fa-forward',         cls: 'skipped', label: 'Ignoré' },
  error:      { icon: 'fa-solid fa-triangle-exclamation', cls: 'error', label: 'Échec' },
  stopped:    { icon: 'fa-solid fa-hand',            cls: 'skipped', label: 'Arrêté' },
};

export function BatchRunDialog({
  prompts,               // filtered library prompts available to run
  model,                 // { providerId, modelId, label }
  allModels,             // for the in-dialog model picker
  modelsLoading,
  backend = '',
  selectedProviderId = '',
  selectedModelId = '',
  agentId = 'claude-code',
  agentModelId = '',
  onExecutorChange,
  onProviderSettingsClick,
  hasDirectory,
  onPickDirectory,
  deps,                  // { generate, runSandbox, heal, save, load, hasExistingForModel, beginRun, abortInFlight }
  runId,
  theme = 'dark',
  onOpenGallery,
  onOpenRuns,
  onClose,
  addToast,
}) {
  // phase: 'config' | 'running' | 'done'
  const [phase, setPhase] = useState('config');
  const [outputView, setOutputView] = useState('log');
  const [logFilter, setLogFilter] = useState('all');
  const [logEntries, setLogEntries] = useState([]);
  const [logModels, setLogModels] = useState([]);
  const [costCalls, setCostCalls] = useState([]);
  const journalRef = useRef(null);
  const journalStartedAtRef = useRef(0);
  const journalRunListRef = useRef([]);
  const syncJournal = useCallback(() => {
    const rows = journalRef.current?.entries() || [];
    setLogEntries(prev => prev.length === rows.length && prev.at(-1)?.id === rows.at(-1)?.id ? prev : rows);
  }, []);
  const [liveCalls, setLiveCalls] = useState(getInFlight);
  useEffect(() => subscribeInFlight(setLiveCalls), []);

  // Selection — start with everything ticked so "just press Go" runs all.
  const [selectedIds, setSelectedIds] = useState(() => new Set(prompts.map(p => p.id)));

  // One prompt set at a time. Ticks are remembered per prompt, but only the set
  // on screen is counted or run, so Core and Advanced never get lumped together.
  const [promptSet, setPromptSet] = useState('core');
  const [promptSearch, setPromptSearch] = useState('');
  const availableSets = useMemo(
    () => PROMPT_SETS
      .map(s => ({ ...s, count: prompts.filter(p => promptSetOf(p) === s.id).length }))
      .filter(s => s.id === 'core' || s.count > 0),
    [prompts],
  );
  const setPrompts = useMemo(() => prompts.filter(p => promptSetOf(p) === promptSet), [prompts, promptSet]);
  const activeSetMeta = availableSets.find(s => s.id === promptSet);
  const promptChoices = useMemo(() => batchPromptChoices({prompts,setId:promptSet,query:promptSearch,selectedIds}),
    [prompts,promptSet,promptSearch,selectedIds]);
  const visiblePrompts = promptChoices.visible;
  const selectedPrompts = promptChoices.selected;

  // Options
  const [mode, setMode] = useState('quick');
  const [healAttempts, setHealAttempts] = useState(1);
  const [maxRepairRounds, setMaxRepairRounds] = useState(1);
  const [saveBothOnHeal] = useState(true); // per product decision: always keep original + healed
  const [skipExisting, setSkipExisting] = useState(false);
  const [apiRetries, setApiRetries] = useState(0);
  const [totalTokens, setTotalTokens] = useState(()=>{const n=readStored(SETTINGS_KEY,{}).totalTokens;return Number.isSafeInteger(n)&&n>0?n:DEFAULT_HTML_BUDGET.totalTokens;});
  const [reasoningTokens, setReasoningTokens] = useState(()=>{const n=readStored(SETTINGS_KEY,{}).reasoningTokens;return Number.isSafeInteger(n)&&n>0?n:DEFAULT_HTML_BUDGET.reasoningTokens;});
  const [settingsProfile,setSettingsProfile]=useState(()=>{const profile=readStored(SETTINGS_KEY,{}).profile;return ['maximum','code','manual'].includes(profile)?profile:'maximum';});
  const [settingsOverrides,setSettingsOverrides]=useState(()=>{const value=readStored(SETTINGS_KEY,{}).overrides;return value&&typeof value==='object'&&!Array.isArray(value)?value:{};});
  useEffect(()=>writeStored(SETTINGS_KEY,{profile:settingsProfile,overrides:settingsOverrides,totalTokens,reasoningTokens}),[settingsProfile,settingsOverrides,totalTokens,reasoningTokens]);
  const [apiCatalogue,setApiCatalogue]=useState([]);
  const [settingsLoading,setSettingsLoading]=useState(false);
  const [settingsError,setSettingsError]=useState('');
  const [delaySec, setDelaySec] = useState(0);
  const [showLiveOutput, setShowLiveOutput] = useState(true);
  // Several models in one launch: empty means "just the model picked above".
  const [batchModels, setBatchModels] = useState(() => {
    const stored = readStored(MODELS_KEY, []);
    return Array.isArray(stored) ? stored.filter(m => m?.providerId && m?.modelId) : [];
  });
  const [laneMode, setLaneMode] = useState(() => (readStored(LANE_MODE_KEY, 'parallel') === 'sequential' ? 'sequential' : 'parallel'));
  useEffect(() => writeStored(MODELS_KEY, batchModels), [batchModels]);
  useEffect(() => writeStored(LANE_MODE_KEY, laneMode), [laneMode]);

  // Run state
  const [items, setItems] = useState([]);       // aligned to the run list
  const [runList, setRunList] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [inspectedIndex, setInspectedIndex] = useState(-1);
  const [outputs, setOutputs] = useState([]);
  const [outputStats, setOutputStats] = useState([]);
  const [fullscreenIndex, setFullscreenIndex] = useState(-1);
  const [fullscreenLoading, setFullscreenLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [pauseState, setPauseState] = useState('running'); // running | pausing | paused
  const [pauseContext, setPauseContext] = useState(null);
  const [rateClock, setRateClock] = useState(() => Date.now());
  const stopRef = useRef(false);
  const startingRef=useRef(false);
  const mountedRef=useRef(true);
  useEffect(()=>()=>{mountedRef.current=false;},[]);
  const pauseRequestedRef = useRef(false);
  // One resolver per lane waiting at a pause boundary (lanes can run side by side).
  const pauseResolversRef = useRef([]);
  const runningLanesRef = useRef(0);
  const listEndRef = useRef(null);
  const activeIndexRef = useRef(-1);
  const followActiveRef = useRef(true);
  const showLiveOutputRef = useRef(showLiveOutput);
  const fullscreenIndexRef = useRef(-1);
  const streamTimingsRef = useRef([]);
  showLiveOutputRef.current = showLiveOutput;
  fullscreenIndexRef.current = fullscreenIndex;

  const activeBackend = backend || model?.backend || 'model';
  const activeProviderId = selectedProviderId || (activeBackend === 'model' ? model?.providerId : '');
  const activeModelId = selectedModelId || (activeBackend === 'model' ? model?.modelId : '');
  const hasModel = !!(model?.providerId && model?.modelId);
  const runModels = useMemo(() => {
    if (batchModels.length) return batchModels;
    const snap = snapshotModel(model);
    return snap ? [snap] : [];
  }, [batchModels, model]);
  const isOpenRouterModel=selected=>selected.providerId==='openrouter'||deps.getProviderType?.(selected.providerId)==='openrouter'||allModels.find(m=>m.providerId===selected.providerId&&m.modelId===selected.modelId)?.providerType==='openrouter';
  const needsApiCapabilities=runModels.some(isOpenRouterModel);
  const refreshCapabilities = useCallback(async () => {
    if (!needsApiCapabilities || !deps.fetchModelCapabilities) return [];
    setSettingsLoading(true); setSettingsError('');
    try { const models=await deps.fetchModelCapabilities({refresh:true}); setApiCatalogue(models); return models; }
    catch(error) { setSettingsError('Lecture API impossible : '+error.message); throw error; }
    finally { setSettingsLoading(false); }
  },[deps.fetchModelCapabilities,needsApiCapabilities]);
  useEffect(()=>{ refreshCapabilities().catch(()=>{}); },[refreshCapabilities]);
  const settingsReports = (catalogue=apiCatalogue) => runModels.map(selected => {
    const original=allModels.find(m=>m.providerId===selected.providerId&&m.modelId===selected.modelId);
    const isOpenRouter=isOpenRouterModel(selected);
    if(!isOpenRouter)return {model:selected,isOpenRouter:false};
    const api=catalogue.find(m=>(m.modelId||m.id)===selected.modelId)||original;
    const override=settingsOverrides[batchModelKey(selected)]||{};
    try {return {model:selected,isOpenRouter:true,settings:resolveModelSettings({model:api,profile:settingsProfile,...override,budget:{totalTokens,reasoningTokens,...override}})};}
    catch(error) {return {model:selected,isOpenRouter:true,error:error.message};}
  });
  const previewReports=settingsReports();
  const overrideSettings=(selected,patch)=>setSettingsOverrides(previous=>({...previous,[batchModelKey(selected)]:{...(previous[batchModelKey(selected)]||{}),...patch}}));

  const isMulti = runModels.length > 1;
  const canRun = runModels.length > 0;
  const selectedInList = hasModel && batchModels.some(m => batchModelKey(m) === batchModelKey(model));
  const selectedCount = selectedPrompts.length;

  const alreadyRunCount = useMemo(() => {
    let n = 0;
    for (const m of runModels) {
      for (const p of visiblePrompts) {
        if (!selectedIds.has(p.id)) continue;
        try { if (deps.hasExistingForModel?.(p, m)) n++; } catch (e) { /* ignore */ }
      }
    }
    return n;
  }, [visiblePrompts, selectedIds, runModels, deps]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && phase !== 'running') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  const toggleOne = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // All / None touch only the set on screen.
  const selectAll = useCallback(() => setSelectedIds(prev => {
    const next = new Set(prev);
    for (const p of visiblePrompts) next.add(p.id);
    return next;
  }), [visiblePrompts]);
  const selectNone = useCallback(() => setSelectedIds(prev => {
    const next = new Set(prev);
    for (const p of visiblePrompts) next.delete(p.id);
    return next;
  }), [visiblePrompts]);

  useEffect(() => {
    if (phase !== 'running') return;
    journalRef.current?.observeCalls(liveCalls, rateClock);
    syncJournal();
  }, [liveCalls, rateClock, phase, syncJournal]);

  const handleEvent = useCallback((event) => {
    journalRef.current?.event(event, {model:event.model, index:event.index, title:journalRunListRef.current[event.index]?.title});
    syncJournal();
    if (event.type === 'cost') {
      const call = {...event.call,index:event.index,modelKey:logModelKey(event.model),modelLabel:safeLogText(event.model?.label || event.model?.modelId || ''),promptTitle:safeLogText(journalRunListRef.current[event.index]?.title || '')};
      setCostCalls(prev => [...prev.filter(c => c.id !== call.id),call]);
      return;
    }
    if (event.type === 'item') {
      if (event.status === 'start') {
        activeIndexRef.current = event.index;
        streamTimingsRef.current[event.index] = null;
        setActiveIndex(event.index);
        if (showLiveOutputRef.current) {
          setOutputs(prev => {
            const next = prev.slice();
            next[event.index] = '';
            return next;
          });
          setOutputStats(prev => {
            const next = prev.slice();
            next[event.index] = null;
            return next;
          });
          if (followActiveRef.current) setInspectedIndex(event.index);
        }
        return;
      }
      const captureOutput = showLiveOutputRef.current || fullscreenIndexRef.current === event.index;
      if (captureOutput && ['generating', 'healing', 'repairing'].includes(event.status)) {
        streamTimingsRef.current[event.index] = null;
        setOutputStats(prev => {
          const next = prev.slice();
          next[event.index] = null;
          return next;
        });
      } else {
        const timing = streamTimingsRef.current[event.index];
        if (timing?.startedAt && !timing.endedAt) timing.endedAt = Date.now();
      }
      setItems(prev => {
        const next = prev.slice();
        const cur = next[event.index] || {};
        next[event.index] = {
          ...cur,
          status: event.status,
          message: event.message || cur.message || '',
          healAttempt: event.healAttempt || cur.healAttempt || 0,
          healed: event.healed ?? cur.healed,
          savedIds: event.savedIds || cur.savedIds || [],
          repairRound: event.repairRound || event.repairRounds || cur.repairRound || 0,
          verificationStatus: event.verificationStatus || cur.verificationStatus || '',
        };
        return next;
      });
    } else if (event.type === 'preview' || event.type === 'chunk') {
      if (!showLiveOutputRef.current && fullscreenIndexRef.current !== event.index) return;
      if (event.type === 'chunk' && event.html) {
        const now = Date.now();
        const timing = streamTimingsRef.current[event.index];
        if (!timing?.startedAt) streamTimingsRef.current[event.index] = { startedAt: now, endedAt: null };
        setRateClock(now);
      }
      // Keep every prompt's latest complete/partial output. This lets users
      // inspect earlier generations without detaching the active stream.
      setOutputs(prev => {
        const next = prev.slice();
        next[event.index] = event.html || '';
        return next;
      });
    } else if (event.type === 'stats') {
      if (!showLiveOutputRef.current && fullscreenIndexRef.current !== event.index) return;
      setOutputStats(prev => {
        const next = prev.slice();
        next[event.index] = event.stats || null;
        return next;
      });
    } else if (event.type === 'done') {
      setSummary(event.summary);
    }
  }, []);

  useEffect(() => {
    if (phase === 'running') listEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [items, phase]);

  const waitAtPauseBoundary = useCallback(async (context) => {
    if (!pauseRequestedRef.current || stopRef.current) return;
    setPauseContext(context || null);
    await new Promise(resolve => {
      pauseResolversRef.current.push(resolve);
      // "Paused" only once no lane still has a model call in flight.
      if (pauseResolversRef.current.length >= runningLanesRef.current) setPauseState('paused');
    });
  }, []);

  const releasePaused = () => {
    const waiting = pauseResolversRef.current;
    pauseResolversRef.current = [];
    for (const resolve of waiting) resolve();
  };

  const start = useCallback(async () => {
    if(startingRef.current)return;
    if (!canRun) { addToast('Sélectionnez d’abord un modèle', 'error'); return; }
    if (!hasDirectory) { addToast('Connectez d’abord un dossier : les générations y seront enregistrées', 'error'); return; }
    const list = selectedPrompts;
    if (list.length === 0) { addToast('Sélectionnez au moins un prompt', 'error'); return; }

    startingRef.current=true;
    let reports;
    try {
      const catalogue=deps.fetchModelCapabilities?await refreshCapabilities():apiCatalogue;
      if(!mountedRef.current){startingRef.current=false;return;}
      reports=settingsReports(catalogue);
      const failure=reports.find(report=>report.error);
      if(failure)throw new Error(failure.error);
    } catch(error) {startingRef.current=false;if(mountedRef.current)addToast(error.message,'error');return;}
    const configured=reports.map(report=>{
      if(!report.isOpenRouter)return report.model;
      const override=settingsOverrides[batchModelKey(report.model)]||{};
      const shown=previewReports.find(r=>batchModelKey(r.model)===batchModelKey(report.model))?.settings;
      return {...report.model,generationOptions:{profile:settingsProfile,...override,budget:{totalTokens,reasoningTokens,...override},
        reviewedMaxTokens:shown?.params.max_tokens??shown?.params.max_completion_tokens??report.settings.params.max_tokens??report.settings.params.max_completion_tokens}};
    });
    const plan = planBatchLanes({ prompts: list, models: configured, runId });
    const startedAt = Date.now();
    journalStartedAtRef.current = startedAt;
    setRateClock(startedAt);
    journalRunListRef.current = plan.runList;
    journalRef.current = createBatchJournal({models:runModels,startedAt});
    setLogModels(runModels);
    setLogEntries([]);
    setCostCalls([]);
    setLogFilter('all');
    setOutputView('log');
    setRunList(plan.runList);
    setItems(plan.runList.map(() => ({ status: 'queued' })));
    setOutputs(showLiveOutput ? plan.runList.map(() => '') : []);
    setOutputStats(showLiveOutput ? plan.runList.map(() => null) : []);
    setSummary(null);
    fullscreenIndexRef.current = -1;
    setFullscreenIndex(-1);
    setFullscreenLoading(false);
    setInspectedIndex(-1);
    setActiveIndex(-1);
    activeIndexRef.current = -1;
    followActiveRef.current = true;
    stopRef.current = false;
    deps.beginRun?.();
    pauseRequestedRef.current = false;
    releasePaused();
    setPauseState('running');
    setPauseContext(null);
    setPhase('running');

    // Each lane is one model over the whole list, reporting into its own slice
    // of the run list. Its 'done' is held back: the summary covers every lane.
    const runOne = async (lane) => {
      runningLanesRef.current += 1;
      try {
        return await runBatch({
          prompts: lane.prompts,
          model: lane.model,
          options: {
            mode,
            heal: mode === 'runtime-heal',
            healAttempts,
            maxRepairRounds,
            saveBothOnHeal,
            skipExisting,
            delayMs: Math.max(0, Math.round(delaySec * 1000)),
            apiRetries,
            runId: lane.model.batchRunId,
          },
          deps,
          onEvent: (event) => {
            if (event.type === 'done') return;
            handleEvent({ ...event, model:lane.model, index:typeof event.index === 'number' ? event.index + lane.offset : lane.offset });
          },
          shouldStop: () => stopRef.current,
          shouldPause: () => pauseRequestedRef.current,
          waitIfPaused: waitAtPauseBoundary,
        });
      } catch (e) {
        handleEvent({type:'item',status:'error',index:lane.offset,model:lane.model,message:e.message});
        addToast(`Erreur d’exécution par lot${plan.multi ? ` (${lane.model.label || lane.model.modelId})` : ''}: ${e.message}`, 'error');
        return null;
      } finally {
        runningLanesRef.current -= 1;
        // A lane that ends while others are parked completes the pause.
        if (pauseRequestedRef.current && pauseResolversRef.current.length >= runningLanesRef.current && runningLanesRef.current > 0) {
          setPauseState('paused');
        }
      }
    };

    try {
      const summaries = await runLanes({ lanes: plan.lanes, mode: laneMode, runOne, shouldStop: () => stopRef.current });
      setSummary(combineSummaries(summaries.filter(Boolean)));
    } catch (e) {
      addToast('Erreur d’exécution par lot : ' + e.message, 'error');
    } finally {
      pauseRequestedRef.current = false;
      releasePaused();
      setPauseState('running');
      setPauseContext(null);
      setActiveIndex(-1);
      setPhase('done');
      startingRef.current=false;
    }
  }, [canRun, hasDirectory, selectedPrompts, runModels, laneMode, mode, healAttempts, maxRepairRounds, saveBothOnHeal,
      skipExisting, delaySec, apiRetries, totalTokens, reasoningTokens, settingsProfile, settingsOverrides, apiCatalogue, allModels, showLiveOutput, runId, deps, refreshCapabilities, handleEvent, waitAtPauseBoundary, addToast]);

  const pause = useCallback(() => {
    if (pauseRequestedRef.current || stopRef.current) return;
    pauseRequestedRef.current = true;
    journalRef.current?.event({type:'control',message:'Pause demandée : les appels en cours vont se terminer avant la suspension'});
    syncJournal();
    setPauseState('pausing');
    addToast('Pause demandée : attente de la fin de l’appel au modèle', 'info');
  }, [addToast]);

  const resume = useCallback(() => {
    journalRef.current?.event({type:'control',message:'Reprise demandée'});
    syncJournal();
    if (!pauseRequestedRef.current) return;
    pauseRequestedRef.current = false;
    setPauseState('running');
    setPauseContext(null);
    releasePaused();
    addToast('Lot repris', 'info');
  }, [addToast]);

  // Stop cancels the calls in flight rather than waiting them out: a CLI agent
  // runs with no time limit, so a hung run would otherwise hold the batch
  // forever. Work already saved stays saved; the interrupted item is 'stopped'.
  const stop = useCallback(() => {
    journalRef.current?.event({type:'control',message:'Arrêt demandé : annulation des appels en cours'});
    syncJournal();
    stopRef.current = true;
    pauseRequestedRef.current = false;
    releasePaused();
    deps.abortInFlight?.();
    addToast('Arrêt : annulation de l’exécution en cours…', 'info');
  }, [addToast, deps]);

  const doneCount = items.filter(it => ['saved', 'skipped', 'error', 'stopped', 'verified', 'warned', 'no_progress'].includes(it.status)).length;
  const progressPct = runList.length ? Math.round((doneCount / runList.length) * 100) : 0;
  const activeStatus = items[inspectedIndex >= 0 ? inspectedIndex : activeIndex]?.status || '';
  const isStreaming = ['generating', 'healing', 'repairing'].includes(activeStatus);
  const displayedHtml = inspectedIndex >= 0 ? (outputs[inspectedIndex] || '') : '';
  const displayedCharacters = displayedHtml.length;
  const reportedTokens = inspectedIndex >= 0 ? completionTokenCount(outputStats[inspectedIndex]) : null;
  const displayedTokens = reportedTokens ?? estimatedTokenCount(displayedHtml);
  const displayedTokenLabel = reportedTokens == null && !displayedCharacters ? 'tokens non communiqués'
    : `${displayedTokens.toLocaleString()} token${displayedTokens === 1 ? '' : 's'}${reportedTokens == null ? ' estimés' : ''}`;
  const viewingActive = inspectedIndex >= 0 && batchItemRunning(items[inspectedIndex]);
  const displayedTokenRate = tokensPerSecond(
    inspectedIndex >= 0 ? outputStats[inspectedIndex] : null,
    displayedTokens,
    inspectedIndex >= 0 ? streamTimingsRef.current[inspectedIndex] : null,
    rateClock,
  );
  const displayedTokenRateLabel = formatTokensPerSecond(displayedTokenRate);
  const runIsMulti = useMemo(() => new Set(runList.map(p => p.laneIndex ?? 0)).size > 1, [runList]);
  const rowTitle = (p) => (p ? (runIsMulti && p.modelLabel ? `${p.title} · ${p.modelLabel}` : p.title) : '');
  const inspectedTitle = inspectedIndex >= 0 ? rowTitle(runList[inspectedIndex]) : '';
  const liveStatus = inspectedIndex >= 0
    ? batchLiveStatus(liveCalls, runModels[runList[inspectedIndex]?.laneIndex ?? 0], rateClock) : null;
  const fullscreenHtml = fullscreenIndex >= 0 ? (outputs[fullscreenIndex] || '') : '';
  const fullscreenTitle = fullscreenIndex >= 0 ? (rowTitle(runList[fullscreenIndex]) || 'Generation') : '';
  const fullscreenIsActive = phase === 'running' && batchItemRunning(items[fullscreenIndex]);
  const fullscreenSubtitle = fullscreenIsActive
    ? 'Génération en direct · le lot continue en arrière-plan'
    : phase === 'running'
      ? 'Génération épinglée · le lot continue en arrière-plan'
      : 'Génération du lot enregistrée';

  useEffect(() => {
    if (phase !== 'running') return undefined;
    const timer = window.setInterval(() => setRateClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const inspectOutput = useCallback((index) => {
    if (index < 0 || (!outputs[index] && !batchItemRunning(items[index]))) return;
    followActiveRef.current = index === activeIndexRef.current;
    setInspectedIndex(index);
    const item = journalRunListRef.current[index];
    const selected = logModels[item?.laneIndex ?? 0];
    if (selected) setLogFilter(logModelKey(selected));
  }, [outputs, items, logModels]);

  const returnToLive = useCallback(() => {
    if (activeIndexRef.current < 0) return;
    followActiveRef.current = true;
    setInspectedIndex(activeIndexRef.current);
  }, []);

  const openFullscreen = useCallback(async (index) => {
    if (index < 0 || !runList[index]) return;
    fullscreenIndexRef.current = index;
    setFullscreenIndex(index);
    setFullscreenLoading(false);
    if (outputs[index]) return;

    const savedId = items[index]?.savedIds?.at(-1);
    if (!savedId || !deps.load) return; // Active streams will populate on their next chunk/preview.
    setFullscreenLoading(true);
    try {
      const generation = await deps.load(savedId);
      if (fullscreenIndexRef.current !== index) return;
      const loadedHtml = generation?.response || '';
      setOutputs(prev => {
        const next = prev.slice();
        next[index] = loadedHtml;
        return next;
      });
      if (!loadedHtml) addToast('Cette génération enregistrée ne contient aucun HTML à afficher', 'error');
    } catch (error) {
      if (fullscreenIndexRef.current === index) addToast('Impossible d’ouvrir la génération : ' + error.message, 'error');
    } finally {
      if (fullscreenIndexRef.current === index) setFullscreenLoading(false);
    }
  }, [runList, outputs, items, deps, addToast]);

  const closeFullscreen = useCallback(() => {
    const index = fullscreenIndexRef.current;
    fullscreenIndexRef.current = -1;
    setFullscreenIndex(-1);
    setFullscreenLoading(false);
    if (!showLiveOutputRef.current && index >= 0) {
      setOutputs(prev => {
        const next = prev.slice();
        next[index] = '';
        return next;
      });
      setOutputStats(prev => {
        const next = prev.slice();
        next[index] = null;
        return next;
      });
    }
  }, []);

  // ── Renderers ──

  const renderConfig = () => html`
    <div class="modal-body batch-config">
      <div class=${`batch-model-row ${hasModel ? '' : 'warn'}`}>
        <div class="batch-model-label">
          <i class=${`fa-solid ${hasModel ? 'fa-microchip' : 'fa-triangle-exclamation'}`}></i>
          ${hasModel
            ? html`<span>Modèle : <strong>${model.label || model.modelId}</strong></span>`
            : html`<span>Aucun modèle chargé : choisissez-en un pour lancer le lot</span>`}
        </div>
        <${ExecutorModelSelector}
          models=${allModels}
          backend=${activeBackend}
          providerId=${activeProviderId}
          modelId=${activeModelId}
          agentId=${agentId}
          agentModelId=${agentModelId}
          onChange=${onExecutorChange}
          disabled=${allModels.length === 0 && !modelsLoading && activeBackend !== 'agent'}
          loading=${modelsLoading}
          onSettingsClick=${onProviderSettingsClick}
        />
      </div>

      <div class="batch-section batch-models">
        <div class="batch-section-head">
          <span><i class="fa-solid fa-users-gear"></i> Modèles (${runModels.length})</span>
          <span class="batch-select-actions">
            <button class="btn btn-xs" onClick=${() => setBatchModels(list => addBatchModel(list, model))}
              disabled=${!hasModel || selectedInList}
              title=${selectedInList ? 'Déjà dans la liste' : 'Ajouter au lot le modèle sélectionné ci-dessus'}>
              <i class="fa-solid fa-plus"></i> Ajouter le modèle sélectionné
            </button>
            ${batchModels.length > 0 && html`
              <button class="btn btn-xs" onClick=${() => setBatchModels([])} title="Revenir à l’exécution du seul modèle sélectionné">Effacer</button>
            `}
          </span>
        </div>
        ${batchModels.length === 0
          ? html`<div class="batch-models-hint">Exécute le modèle sélectionné. Pour en comparer plusieurs, choisissez-en un et cliquez sur <strong>Ajouter le modèle sélectionné</strong>, puis choisissez le suivant.</div>`
          : html`
            <div class="batch-model-chips">
              ${batchModels.map((m, i) => html`
                <span class="batch-model-chip" key=${batchModelKey(m)}>
                  <span class="batch-model-lane">${i + 1}</span>
                  <span class="batch-model-name" title=${m.label || m.modelId}>${m.label || m.modelId}</span>
                  <button class="btn-icon" title="Retirer de ce lot" aria-label=${`Retirer ${m.label || m.modelId}`}
                    onClick=${() => setBatchModels(list => list.filter(x => batchModelKey(x) !== batchModelKey(m)))}>
                    <i class="fa-solid fa-xmark"></i>
                  </button>
                </span>
              `)}
            </div>
          `}
        ${isMulti && html`
          <div class="batch-options batch-lane-modes" role="radiogroup" aria-label="Mode d’exécution des modèles">
            <label class="batch-opt batch-mode-opt">
              <input type="radio" name="batch-lane-mode" value="parallel" checked=${laneMode === 'parallel'} onChange=${() => setLaneMode('parallel')} />
              <span><strong>Simultanément</strong><small>Tous les modèles traitent la liste en parallèle. Plus rapide pour les agents CLI et les modèles hébergés.</small></span>
            </label>
            <label class="batch-opt batch-mode-opt">
              <input type="radio" name="batch-lane-mode" value="sequential" checked=${laneMode === 'sequential'} onChange=${() => setLaneMode('sequential')} />
              <span><strong>L’un après l’autre</strong><small>Terminer un modèle avant le suivant. À utiliser si les modèles partagent le même GPU local.</small></span>
            </label>
          </div>
        `}
        ${isMulti && html`<div class="batch-note"><i class="fa-solid fa-layer-group"></i> Chaque modèle est enregistré dans une exécution distincte, regroupée dans Exécutions pour la comparaison.</div>`}
      </div>

      ${!hasDirectory && html`
        <div class="batch-dir-hint">
          <i class="fa-solid fa-circle-info"></i>
          Connectez un dossier : les générations y seront enregistrées.
          <button class="btn btn-sm" onClick=${onPickDirectory}><i class="fa-solid fa-folder-plus"></i> Choisir un dossier</button>
        </div>
      `}

      <div class="batch-section">
        <div class="batch-section-head">
          <span><i class="fa-solid fa-list-check"></i> Prompts (${selectedCount}/${visiblePrompts.length})</span>
          <span class="batch-select-actions">
            <button class="btn btn-xs" onClick=${selectAll} title="Sélectionner tous les prompts affichés">Tous</button>
            <button class="btn btn-xs" onClick=${selectNone} title="Désélectionner tous les prompts affichés">Aucun</button>
          </span>
        </div>
        ${availableSets.length > 1 && html`
          <div class="batch-set-switch" role="group" aria-label="Série de prompts">
            ${availableSets.map(s => html`
              <button
                key=${s.id}
                type="button"
                class=${`library-cat-chip ${promptSet === s.id ? 'active' : ''}`}
                aria-pressed=${promptSet === s.id}
                title=${s.hint}
                onClick=${() => setPromptSet(s.id)}
              ><i class=${`fa-solid ${s.icon}`}></i>${s.label}<span class="batch-set-count">${s.count}</span></button>
            `)}
            ${activeSetMeta?.hint && html`<span class="batch-set-hint">${activeSetMeta.hint}. Seule cette série sera exécutée.</span>`}
          </div>
        `}
        <div class="batch-prompt-search">
          <label for="batch-prompt-search">Rechercher un prompt</label>
          <div class="batch-prompt-search-input">
            <input id="batch-prompt-search" class="form-input" type="search" value=${promptSearch} maxLength="200"
              placeholder="Titre, nom d’origine, description ou étiquette…" onInput=${e => setPromptSearch(e.target.value)} />
            ${promptSearch && html`<button class="btn btn-sm" onClick=${() => setPromptSearch('')}>Effacer la recherche</button>`}
          </div>
          ${promptSearch.trim() && html`<div class="batch-search-summary" role="status">${visiblePrompts.length} résultat(s) dans ${activeSetMeta?.label || 'cette série'}, sur ${setPrompts.length} prompts. Seuls les résultats cochés seront lancés.</div>`}
        </div>
        <div class="batch-prompt-list">
          ${visiblePrompts.length === 0
            ? html`<div class="batch-empty">${promptSearch.trim() ? 'Aucun résultat dans cette série.' : 'Aucun prompt à exécuter dans cette série.'}
                ${promptSearch.trim() && availableSets.filter(s => s.id !== promptSet && promptChoices.matchingSets[s.id]).map(s => html`
                  <button key=${s.id} class="btn btn-sm" onClick=${() => setPromptSet(s.id)}>Voir ${promptChoices.matchingSets[s.id]} résultat(s) dans ${s.label}</button>
                `)}
              </div>`
            : visiblePrompts.map(p => html`
              <label class="batch-prompt-row" key=${p.id}>
                <input type="checkbox" checked=${selectedIds.has(p.id)} onChange=${() => toggleOne(p.id)} />
                <span class="batch-prompt-title" title=${p.title}>${p.title}</span>
                ${!isMulti && runModels[0] && (() => { try { return deps.hasExistingForModel?.(p, runModels[0]); } catch (e) { return false; } })()
                  ? html`<span class="batch-prompt-badge" title="Dispose déjà d’une génération pour ce modèle">déjà exécuté</span>`
                  : null}
              </label>
            `)}
        </div>
        ${skipExisting && alreadyRunCount > 0 && html`
          <div class="batch-note"><i class="fa-solid fa-forward"></i> ${alreadyRunCount} prompt${alreadyRunCount === 1 ? '' : 's'} ignoré(s) : déjà exécuté(s) pour ${isMulti ? 'ce modèle' : 'le modèle actuel'}.</div>
        `}
      </div>

      <div class="batch-section">
        <div class="batch-section-head"><span><i class="fa-solid fa-wand-magic-sparkles"></i> Mode de génération</span></div>
        <div class="batch-options">
          <label class="batch-opt batch-mode-opt">
            <input type="radio" name="batch-mode" value="quick" checked=${mode === 'quick'} onChange=${() => setMode('quick')} />
            <span><strong>Rapide</strong><small>Générer une fois à partir du prompt et du déroulement existants.</small></span>
          </label>
          <label class="batch-opt batch-mode-opt">
            <input type="radio" name="batch-mode" value="runtime-heal" checked=${mode === 'runtime-heal'} onChange=${() => setMode('runtime-heal')} />
            <span><strong>Correction des erreurs</strong><small>Vérifier le bac à sable et corriger les erreurs d’exécution capturées.</small></span>
          </label>
          <label class="batch-opt batch-mode-opt">
            <input type="radio" name="batch-mode" value="verified"
              checked=${mode === 'verified'} onChange=${() => setMode('verified')} />
            <span><strong>Vérifié</strong><small>Évaluer les exigences du prompt à partir des observations du bac à sable.</small></span>
          </label>
          ${mode === 'runtime-heal' && html`
            <label class="batch-opt batch-opt-indent">
              <span>Tentatives maximales</span>
              <select class="form-input batch-num" value=${healAttempts} onChange=${(e) => setHealAttempts(Number(e.target.value))}>
                ${[1, 2, 3].map(n => html`<option key=${n} value=${n}>${n}</option>`)}
              </select>
              <span class="batch-opt-hint">conserve les versions originale et corrigée</span>
            </label>
          `}
          ${mode === 'verified' && html`
            <label class="batch-opt batch-opt-indent">
              <span>Cycles de correction vérifiée</span>
              <select class="form-input batch-num" value=${maxRepairRounds} onChange=${(e) => setMaxRepairRounds(Number(e.target.value))}>
                ${[0, 1, 2].map(n => html`<option key=${n} value=${n}>${n}</option>`)}
              </select>
            </label>
            <div class="batch-verified-cost"><i class="fa-solid fa-coins"></i> Utilise un audit et jusqu’à deux appels de correction et de nouvel audit par prompt. Chaque version est enregistrée.</div>
          `}
        </div>
      </div>

      <div class="batch-section">
        <div class="batch-section-head"><span><i class="fa-solid fa-sliders"></i> Options d’exécution</span></div>
        <div class="batch-options">
          <label class="batch-opt">
            <input type="checkbox" checked=${skipExisting} onChange=${(e) => setSkipExisting(e.target.checked)} />
            <span>Ignorer les prompts déjà exécutés pour ce modèle</span>
          </label>
          <label class="batch-opt batch-live-output-option">
            <input type="checkbox" checked=${showLiveOutput} onChange=${(e) => setShowLiveOutput(e.target.checked)} />
            <span>Afficher la génération en direct dans cette fenêtre</span>
            <span class="batch-opt-hint">Désactiver pour réduire la mémoire utilisée lors des grands lots.</span>
          </label>
          <label class="batch-opt">
            <span>Nouvelles tentatives après erreur de connexion</span>
            <select class="form-input batch-num" value=${apiRetries} onChange=${(e) => setApiRetries(Number(e.target.value))}>
              ${[0, 1, 2, 3].map(n => html`<option key=${n} value=${n}>${n}</option>`)}
            </select>
          </label>
          <div class="batch-opt-hint">Les nouvelles tentatives sont désactivées par défaut. Une réponse vide ou incomplète ne sera jamais relancée automatiquement.</div>
          <label class="batch-opt"><span>Adaptation aux capacités API</span>
            <select class="form-input" value=${settingsProfile} onChange=${e=>{setSettingsProfile(e.target.value);setSettingsOverrides({});}}>
              <option value="maximum">Qualité maximale — limites API</option><option value="code">Génération de code — raisonnement réduit</option><option value="manual">Budget personnalisé — plafonné par l’API</option>
            </select></label>
          <p class="batch-opt-hint">Qualité maximale utilise l’effort le plus élevé et la sortie maximale annoncés par chaque modèle. Les appels peuvent durer plus longtemps et coûter davantage. Les tokens de raisonnement peuvent consommer tout le budget ; aucun site complet n’est garanti. Aucun appel payant n’est lancé par l’actualisation.</p>
          ${settingsProfile==='manual'&&html`<label class="batch-opt"><span>Budget total demandé par appel</span><input class="form-input" type="number" min="1" value=${totalTokens} onChange=${e=>setTotalTokens(Number(e.target.value))}/></label>
            <label class="batch-opt"><span>Budget de raisonnement demandé (si l’API l’accepte)</span><input class="form-input" type="number" min="1" value=${reasoningTokens} onChange=${e=>setReasoningTokens(Number(e.target.value))}/></label>`}
          <${ModelSettingsPanel} reports=${previewReports} loading=${settingsLoading} error=${settingsError}
            onRefresh=${()=>refreshCapabilities().catch(()=>{})} onOverride=${overrideSettings} onReset=${()=>setSettingsOverrides({})}/>
          <label class="batch-opt">
            <span>Délai entre les prompts</span>
            <input class="form-input batch-num" type="number" min="0" max="120" step="1"
              value=${delaySec} onChange=${(e) => setDelaySec(Math.max(0, Number(e.target.value) || 0))} />
            <span class="batch-opt-hint">secondes</span>
          </label>
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn" onClick=${onClose}>Annuler</button>
      <button class="btn btn-primary btn-generate" onClick=${start} disabled=${!canRun || !hasDirectory || selectedCount === 0 || settingsLoading || previewReports.some(r=>r.error)}>
        <i class="fa-solid fa-play"></i> Lancer ${selectedCount} prompt${selectedCount === 1 ? '' : 's'}${isMulti ? ` × ${runModels.length} modèles` : ''}
      </button>
    </div>
  `;

  const generationCostLabel = index => {
    const total = costTotals(costCalls.filter(call => call.index === index));
    if (!total.calls.length && items[index]?.status === 'skipped') return 'Aucun appel';
    if (total.confirmedUsd == null) return total.calls.some(call=>call.status==='pending') || phase==='running' && !total.calls.length ? 'Coût en attente' : 'Coût non communiqué';
    return `${formatUsd(total.confirmedUsd)}${total.missingCosts ? ` + ${total.missingCosts} coût(s) manquant(s)` : ''}`;
  };

  const renderJournal = (done = false) => html`<${BatchGenerationLog}
    entries=${logEntries} models=${logModels} calls=${liveCalls} startedAt=${journalStartedAtRef.current}
    now=${rateClock} filter=${logFilter} onFilterChange=${setLogFilter} done=${done} costCalls=${costCalls} />`;

  const renderRunning = () => html`
    <div class="modal-body batch-running">
      <div class="batch-progress">
        <div class="batch-progress-bar"><div class="batch-progress-fill" style=${{ width: progressPct + '%' }}></div></div>
        <div class="batch-progress-meta">
          <div class="batch-progress-text">${doneCount} / ${runList.length} terminé(s)${pauseState === 'paused'
            ? ` · en pause${pauseContext?.prompt?.title ? ` avant « ${pauseContext.prompt.title} »` : ''}`
            : phase === 'running' && activeIndex >= 0 ? ` · exécution de « ${runList[activeIndex]?.title || ''} »` : ''}</div>
          <div class=${`batch-stream-count ${isStreaming ? 'is-streaming' : ''}`} aria-live="polite">
            ${!showLiveOutput
              ? html`<i class="fa-solid fa-eye-slash"></i> Génération en direct masquée pour économiser la mémoire`
              : !viewingActive && inspectedIndex >= 0
              ? html`<i class="fa-solid fa-eye"></i> Affichage du résultat enregistré · ${displayedCharacters.toLocaleString()} car. · ${displayedTokenLabel} · ${displayedTokenRateLabel}`
              : html`
                <i class=${`fa-solid ${isStreaming ? 'fa-spinner fa-spin' : displayedCharacters ? 'fa-code' : 'fa-hourglass-half'}`}></i>
                ${displayedCharacters
                  ? `${displayedCharacters.toLocaleString()} caractère${displayedCharacters === 1 ? '' : 's'} reçus · ${displayedTokenLabel} · ${displayedTokenRateLabel}`
                  : liveStatus ? `${liveStatus.label} · ${liveStatus.elapsed}${liveStatus.outputChars ? ` · ${liveStatus.outputChars.toLocaleString()} caractères de réponse reçus` : ''}`
                    : 'En attente du premier fragment de code…'}
              `}
          </div>
        </div>
      </div>

      <${BatchCosts} calls=${costCalls} />
      ${runIsMulti && html`<div class="batch-note">Les modèles tournent en parallèle. Sélectionnez une ligne pour changer l’aperçu et le flux HTML affichés.</div>`}

      ${pauseState !== 'running' && html`
        <div class=${`batch-pause-state ${pauseState}`} role="status" aria-live="polite">
          <i class=${`fa-solid ${pauseState === 'paused' ? 'fa-circle-pause' : 'fa-spinner fa-spin'}`}></i>
          <div>
            <strong>${pauseState === 'paused' ? 'En pause' : 'Mise en pause…'}</strong>
            <span>${pauseState === 'paused'
              ? `Aucun appel au modèle en cours${pauseContext?.prompt?.title ? ` · suivant : ${pauseContext.prompt.title}` : ''}.`
              : 'Fin de l’appel au modèle en cours ; aucun nouvel appel ne sera lancé.'}</span>
          </div>
        </div>
      `}

      <div class="batch-output-tabs" role="group" aria-label="Affichage du suivi">
        <button class=${`btn btn-sm ${outputView === 'log' ? 'btn-primary' : ''}`} aria-pressed=${outputView === 'log'} onClick=${() => setOutputView('log')}>Journal de génération</button>
        <button class=${`btn btn-sm ${outputView === 'preview' ? 'btn-primary' : ''}`} aria-pressed=${outputView === 'preview'} onClick=${() => setOutputView('preview')}>Aperçu et code</button>
      </div>
      <div class="batch-run-body">
        <div class="batch-run-list">
          ${runList.map((p, idx) => {
            const it = items[idx] || { status: 'queued' };
            const m = STATUS_META[it.status] || STATUS_META.queued;
            const isActive = batchItemRunning(it);
            const isInspected = idx === inspectedIndex;
            const canInspect = showLiveOutput && (!!outputs[idx] || isActive);
            const canOpenFullscreen = isActive || !!outputs[idx] || !!it.savedIds?.length;
            const rowLive = it.status === 'generating'
              ? batchLiveStatus(liveCalls, runModels[p.laneIndex ?? 0], rateClock) : null;
            return html`
              <div
                class=${`batch-run-item ${m.cls} ${isActive ? 'is-active' : ''} ${isInspected ? 'is-inspected' : ''} ${canInspect ? 'is-inspectable' : ''}`}
                key=${p.runKey || p.id}
                role=${canInspect ? 'button' : undefined}
                tabIndex=${canInspect ? 0 : undefined}
                aria-current=${isInspected ? 'true' : undefined}
                title=${canInspect ? (isActive ? 'Voir la génération en direct' : 'Examiner cette génération pendant l’exécution du lot') : ''}
                onClick=${canInspect ? () => inspectOutput(idx) : undefined}
                onKeyDown=${canInspect ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    inspectOutput(idx);
                  }
                } : undefined}
              >
                <i class=${`batch-run-icon fa ${m.icon} ${m.cls === 'active' ? 'fa-fade' : ''}`}></i>
                <span class="batch-run-title" title=${rowTitle(p)}>${p.title}${runIsMulti && p.modelLabel ? html`<span class="batch-run-model">${p.modelLabel}</span>` : null}</span>
                <span class="batch-run-cost">${generationCostLabel(idx)}</span>
                <span class="batch-run-status">
                  ${it.status === 'healing' && it.healAttempt ? `correction ${it.healAttempt}`
                    : it.status === 'repairing' && it.repairRound ? `Réparation · cycle ${it.repairRound}`
                    : rowLive ? `${rowLive.label} · ${rowLive.elapsed}` : m.label}
                  ${it.healed && it.status === 'saved' ? html` <span class="batch-healed-chip">corrigé</span>` : null}
                  ${canOpenFullscreen ? html`
                    <button class="batch-fullscreen-button" title="Ouvrir la génération interactive en plein écran"
                      onClick=${(event) => { event.stopPropagation(); openFullscreen(idx); }}>
                      <i class="fa-solid fa-expand"></i>
                    </button>` : null}
                </span>
              </div>
            `;
          })}
          <div ref=${listEndRef}></div>
        </div>
        ${outputView === 'log' ? renderJournal() : showLiveOutput
          ? html`
            <div class="batch-preview">
              <div class="batch-preview-head">
                <span title=${inspectedTitle}><i class="fa-solid fa-display"></i> ${inspectedTitle || 'Aperçu'}</span>
                <span class="batch-preview-actions">
                  ${displayedHtml ? html`
                    <button class="batch-fullscreen-button" title="Ouvrir la génération interactive en plein écran"
                      onClick=${() => openFullscreen(inspectedIndex)}>
                      <i class="fa-solid fa-expand"></i> Plein écran
                    </button>` : null}
                  ${!viewingActive && activeIndex >= 0
                    ? html`<button class="batch-return-live" onClick=${returnToLive}><i class="fa-solid fa-tower-broadcast"></i> Revenir au direct</button>`
                    : pauseState === 'paused'
                      ? html`<span class="batch-live-chip is-paused"><i class="fa-solid fa-circle-pause"></i> En pause</span>`
                      : html`<span class="batch-live-chip"><i class="fa-solid fa-circle"></i> En direct</span>`}
                </span>
              </div>
              ${displayedHtml
                ? html`<iframe class="batch-preview-frame" sandbox="allow-scripts" srcdoc=${displayedHtml} title=${`Aperçu : ${inspectedTitle || 'génération en cours'}`}></iframe>`
                : html`<div class="batch-preview-empty"><i class="fa-solid fa-hourglass-half"></i><span>L’aperçu en direct apparaîtra ici</span></div>`}
            </div>`
          : html`
            <div class="batch-preview batch-preview-disabled" role="status">
              <div class="batch-preview-empty">
                <i class="fa-solid fa-eye-slash"></i>
                <strong>Génération en direct masquée</strong>
                <span>L’aperçu et l’affichage du code sont désactivés pour cette exécution.</span>
                ${activeIndex >= 0 ? html`
                  <button class="btn btn-sm batch-open-active-fullscreen" onClick=${() => openFullscreen(activeIndex)}>
                    <i class="fa-solid fa-expand"></i> Ouvrir la génération en cours en plein écran
                  </button>` : null}
              </div>
            </div>`}
      </div>

      ${outputView === 'preview' && showLiveOutput && html`
        <section class="batch-code-stream" aria-label="Sortie HTML en direct">
          <div class="batch-code-stream-head">
            <span><i class="fa-solid fa-code"></i> ${viewingActive && pauseState === 'running' ? 'Flux HTML en direct' : 'HTML généré'}${inspectedTitle ? ` · ${inspectedTitle}` : ''}</span>
            <span>${displayedCharacters.toLocaleString()} car. · ${displayedTokenLabel} · ${displayedTokenRateLabel}</span>
          </div>
          <${CellEditor}
            className="batch-stream-editor"
            value=${displayedHtml}
            kind="html"
            theme=${theme}
            readOnly=${true}
            minLines=${9}
            maxLines=${9}
            fontSize=${12}
            followOutput=${viewingActive}
          />
        </section>
      `}
    </div>

    <div class="modal-footer">
      ${pauseState === 'paused'
        ? html`<button class="btn btn-primary batch-resume-button" onClick=${resume}>
            <i class="fa-solid fa-play"></i> Reprendre
          </button>`
        : html`<button class="btn batch-pause-button" onClick=${pause} disabled=${pauseState === 'pausing' || stopRef.current}
            title="Terminer l’appel au modèle en cours, puis suspendre avant le suivant">
            <i class=${`fa-solid ${pauseState === 'pausing' ? 'fa-spinner fa-spin' : 'fa-pause'}`}></i>
            ${pauseState === 'pausing' ? 'Mise en pause…' : 'Pause'}
          </button>`}
      <button class="btn btn-danger" onClick=${stop} disabled=${stopRef.current}>
        <i class="fa-solid fa-stop"></i> ${stopRef.current ? 'Arrêt…' : 'Arrêter'}
      </button>
    </div>
  `;

  const renderDone = () => html`
    <div class="modal-body batch-done">
      <div class="batch-summary">
        <div class="batch-summary-icon"><i class="fa-solid fa-flag-checkered"></i></div>
        <div class="batch-summary-grid">
          ${runIsMulti ? html`<div class="batch-stat"><strong>${summary?.lanes || 0}</strong><span>modèles</span></div>` : null}
          <div class="batch-stat"><strong>${summary?.generated || 0}</strong><span>générés</span></div>
          <div class="batch-stat"><strong>${summary?.healed || 0}</strong><span>corrigés</span></div>
          <div class="batch-stat"><strong>${summary?.saved || 0}</strong><span>enregistrés</span></div>
          <div class="batch-stat"><strong>${summary?.skipped || 0}</strong><span>ignorés</span></div>
          <div class=${`batch-stat ${summary?.failed ? 'is-bad' : ''}`}><strong>${summary?.failed || 0}</strong><span>échoués</span></div>
        </div>
        ${(summary?.verifiedPassed || summary?.verifiedWarned || summary?.verifiedFailed || summary?.roleCalls) ? html`
          <div class="batch-verified-summary">
            <span><strong>${summary?.verifiedPassed || 0}</strong> validés</span>
            <span><strong>${summary?.verifiedWarned || 0}</strong> à vérifier</span>
            <span><strong>${summary?.verifiedFailed || 0}</strong> échecs de vérification</span>
            <span><strong>${summary?.roleCalls || 0}</strong> appels de rôle</span>
            <span><strong>${summary?.repairRounds || 0}</strong> cycles de correction</span>
          </div>
        ` : null}
        ${summary?.stopped ? html`<div class="batch-note"><i class="fa-solid fa-hand"></i> Exécution interrompue.</div>` : null}
      </div>

      <${BatchCosts} calls=${costCalls} done=${true} />
      <div class="batch-run-list batch-run-list-done">
        ${runList.map((p, idx) => {
          const it = items[idx] || { status: 'queued' };
          const m = STATUS_META[it.status] || STATUS_META.queued;
          return html`
            <div class=${`batch-run-item ${m.cls}`} key=${p.runKey || p.id}>
              <i class=${`batch-run-icon fa ${m.icon}`}></i>
              <span class="batch-run-title" title=${rowTitle(p)}>${p.title}${runIsMulti && p.modelLabel ? html`<span class="batch-run-model">${p.modelLabel}</span>` : null}</span>
              <span class="batch-run-cost">${generationCostLabel(idx)}</span>
                <span class="batch-run-status">
                ${m.label}${it.healed ? html` <span class="batch-healed-chip">corrigé</span>` : null}
                ${it.repairRound ? html` <span class="batch-healed-chip">${it.repairRound} correction${it.repairRound === 1 ? '' : 's'}</span>` : null}
                ${it.status === 'error' && it.message ? html`<span class="batch-run-err" title=${it.message}> — ${it.message}</span>` : null}
                ${it.savedIds?.length ? html`
                  <button class="batch-fullscreen-button" title="Ouvrir la génération interactive en plein écran"
                    onClick=${() => openFullscreen(idx)}><i class="fa-solid fa-expand"></i></button>` : null}
              </span>
            </div>
          `;
        })}
      </div>
      ${renderJournal(true)}
    </div>

    <div class="modal-footer">
      <button class="btn" onClick=${() => setPhase('config')}><i class="fa-solid fa-rotate-left"></i> Nouvelle exécution</button>
      <button class="btn" onClick=${() => { onOpenGallery?.(); onClose(); }}>
        <i class="fa-solid fa-images"></i> Voir dans la galerie
      </button>
      ${onOpenRuns && html`
        <button class="btn btn-primary" onClick=${() => { onOpenRuns(runIsMulti ? '' : runId); onClose(); }}
          title=${runIsMulti ? "Ouvrir l’onglet Exécutions, où les résultats de chaque modèle sont regroupés" : "Ouvrir les générations de cette exécution dans l’onglet Exécutions"}>
          <i class="fa-solid fa-layer-group"></i> ${runIsMulti ? 'Évaluer ces exécutions' : 'Évaluer cette exécution'}
        </button>
      `}
    </div>
  `;

  return html`
    <${Fragment}>
      <div class="modal-overlay">
        <div class=${`modal batch-dialog ${phase === 'running' ? 'is-running' : ''}`} onClick=${(e) => e.stopPropagation()}>
          <div class="modal-header">
            <h2><i class="fa-solid fa-layer-group"></i> Exécution par lot</h2>
            ${phase !== 'running' && html`
              <button class="btn-icon" onClick=${onClose}><i class="fa-solid fa-xmark"></i></button>
            `}
          </div>
          ${phase === 'config' ? renderConfig() : phase === 'running' ? renderRunning() : renderDone()}
        </div>
      </div>
      ${fullscreenIndex >= 0 && html`
        <${HtmlLightbox}
          html=${fullscreenHtml}
          title=${fullscreenTitle}
          subtitle=${fullscreenSubtitle}
          emptyMessage=${fullscreenLoading ? 'Chargement de la génération enregistrée…' : 'En attente du prochain fragment…'}
          onClose=${closeFullscreen}
        />
      `}
    <//>
  `;
}
