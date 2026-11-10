import { html } from 'htm/preact';
import { withPreviewStorage } from '../../shared/services/preview-storage.js';
import { Fragment } from 'preact';
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';
import { ExecutorModelSelector } from '../../shared/components/ExecutorModelSelector.js';
import { CellEditor } from '../../shared/components/CellEditor.js';
import { BatchCosts } from './BatchCosts.js';
import { BatchLiveComparison } from './BatchLiveComparison.js';
import { BatchActivity } from './BatchActivity.js';
import { costTotals, formatUsd } from '../services/batchCosts.js';
import { executionMetrics, formatDuration } from '../services/executionMetrics.js';
import { BatchGenerationLog } from './BatchGenerationLog.js';
import { createBatchJournal, logModelKey, safeLogText } from '../services/batchGenerationLog.js';
import { HtmlLightbox } from './BatchReview.js';
import { DEFAULT_HTML_BUDGET, restoreGenerationSettings } from '../services/generationBudget.js';
import { DEFAULT_BATCH_MODE, batchGenerationOptions } from '../services/batchMode.js';
import {resolveModelSettings} from '../../shared/services/model-capabilities.js';
import {clearFailedGenerationBlocks} from '../../shared/services/generation-spend-guard.js';
import {ModelSettingsPanel} from './ModelSettingsPanel.js';
import { batchPromptChoices, setVisibleSelection } from '../services/batchPromptSearch.js';
import { runBatch } from '../services/batchRunner.js';
import {retryProposal, manualRetryModel, applyRetrySummaries, createRetryQueue} from '../services/manualRetry.js';
import { prepareGenerationResume } from '../services/resumeGeneration.js';
import { progressivePlan } from '../services/progressiveGeneration.js';
import { getInFlight, subscribeInFlight } from '../../shared/services/generation-telemetry.js';
import { batchLiveStatus, batchItemRunning } from '../services/batchLiveProgress.js';
import { PROMPT_SETS, promptSetOf, promptSetLabel } from '../services/library.js';
import {
  addBatchModel,
  batchModelKey,
  combineSummaries,
  restoreLaneMode,
  planBatchLanes,
  runLanes,
  snapshotModel,
} from '../services/batchPlan.js';

// The multi-model list and lane mode outlive the dialog, so a rerun of the same
// comparison is one click.
const MODELS_KEY = 'prompt-gallery-batch-models';
const LANE_MODE_KEY = 'prompt-gallery-batch-lane-mode-v2';
// Keep saved per-model choices; versioned defaults migrate the old economy profile once.
const SETTINGS_KEY = 'prompt-gallery-model-adaptation-v2';

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
  'not-started': {icon:'fa-regular fa-circle',cls:'queued',label:'Non lancé pour ce modèle'},
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
  'saved-unverified': {icon:'fa-solid fa-floppy-disk',cls:'warn',label:'Enregistré — vérification interrompue'},
};

export function BatchRunDialog({
  prompts,               // Complete merged library, shared with the Prompts page.
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
  presentation = 'modal', // Presentation changes never unmount the batch runner.
  onOpenComparison,
  onMinimize,
  onRestore,
  resumeSource = null,
  onRunningChange,
  addToast,
}) {
  // phase: 'config' | 'running' | 'done'
  const [phase, setPhase] = useState('config');
  const [resumeFrom, setResumeFrom] = useState(resumeSource);
  useEffect(() => { onRunningChange?.(phase === 'running'); }, [phase, onRunningChange]);
  const [outputView, setOutputView] = useState('log');
  const [logFilter, setLogFilter] = useState('all');
  const [logEntries, setLogEntries] = useState([]);
  const [logModels, setLogModels] = useState([]);
  const [costCalls, setCostCalls] = useState([]);
  const [batchFinishedAt, setBatchFinishedAt] = useState(null);
  const journalRef = useRef(null);
  const journalStartedAtRef = useRef(0);
  const journalRunListRef = useRef([]);
  const syncJournal = useCallback(() => {
    const rows = journalRef.current?.entries() || [];
    setLogEntries(prev => prev.length === rows.length && prev.at(-1)?.id === rows.at(-1)?.id ? prev : rows);
  }, []);
  const [liveCalls, setLiveCalls] = useState(getInFlight);
  useEffect(() => subscribeInFlight(setLiveCalls), []);

  // Prompts enter the launch only after an explicit checkbox or bulk selection.
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Categories filter the library; the launch selection is shared across them.
  const [promptSet, setPromptSet] = useState('all');
  const [promptSearch, setPromptSearch] = useState('');
  const availableSets = useMemo(
    () => [{id:'all', label:'Tous les prompts', icon:'fa-list', count:prompts.length,
      hint:'Toute la bibliothèque, y compris vos prompts ajoutés et importés'}, ...PROMPT_SETS
      .map(s => ({ ...s, count: prompts.filter(p => promptSetOf(p) === s.id).length }))
      .filter(s => s.id === 'core' || s.count > 0)],
    [prompts],
  );
  const promptChoices = useMemo(() => batchPromptChoices({prompts,setId:promptSet,query:promptSearch,selectedIds}),
    [prompts,promptSet,promptSearch,selectedIds]);
  const activeSetMeta = availableSets.find(s => s.id === promptChoices.effectiveSet);
  const visiblePrompts = promptChoices.visible;
  const selectedPrompts = useMemo(() => resumeFrom ? [resumeFrom.prompt] : promptChoices.selected, [resumeFrom, promptChoices]);

  // Options
  const [mode, setMode] = useState(resumeSource ? 'automatic' : DEFAULT_BATCH_MODE);
  const [progressive, setProgressive] = useState(true);
  const [healAttempts, setHealAttempts] = useState(1);
  const [maxRepairRounds, setMaxRepairRounds] = useState(1);
  const [saveBothOnHeal] = useState(true); // per product decision: always keep original + healed
  const [skipExisting, setSkipExisting] = useState(false);
  const [apiRetries, setApiRetries] = useState(0);
  const [spendProtection,setSpendProtection]=useState(true);
  const [initialSettings] = useState(() => restoreGenerationSettings(readStored(SETTINGS_KEY, {})));
  const [totalTokens, setTotalTokens] = useState(()=>{const n=initialSettings.totalTokens;return Number.isSafeInteger(n)&&n>0?n:DEFAULT_HTML_BUDGET.totalTokens;});
  const [reasoningTokens, setReasoningTokens] = useState(()=>{const n=initialSettings.reasoningTokens;return Number.isSafeInteger(n)&&n>0?n:DEFAULT_HTML_BUDGET.reasoningTokens;});
  const [settingsProfile,setSettingsProfile]=useState(()=>{return initialSettings.profile;});
  const [settingsOverrides,setSettingsOverrides]=useState(()=>{const value=initialSettings.overrides;return value&&typeof value==='object'&&!Array.isArray(value)?value:{};});
  useEffect(()=>writeStored(SETTINGS_KEY,{defaultsVersion:3,profile:settingsProfile,overrides:settingsOverrides,totalTokens,reasoningTokens}),[settingsProfile,settingsOverrides,totalTokens,reasoningTokens]);
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
  const [laneMode, setLaneMode] = useState(() => restoreLaneMode(readStored(LANE_MODE_KEY, null)));
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
  const [retryReview, setRetryReview] = useState(null);
  const [retryTokens, setRetryTokens] = useState(0);
  const retryQueueRef = useRef(createRetryQueue());
  const retrySummariesRef = useRef([]);
  const mainRunningRef = useRef(false);
  const configuredModelsRef = useRef([]);
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
    if (resumeFrom) return [resumeFrom.model];
    if (batchModels.length) return batchModels;
    const snap = snapshotModel(model);
    return snap ? [snap] : [];
  }, [batchModels, model, resumeFrom]);
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
    const options=batchGenerationOptions({mode,profile:settingsProfile,override:settingsOverrides[batchModelKey(selected)],budget:{totalTokens,reasoningTokens}});
    try {return {model:selected,isOpenRouter:true,settings:resolveModelSettings({model:api,...options})};}
    catch(error) {return {model:selected,isOpenRouter:true,error:error.message};}
  });
  const previewReports=settingsReports();
  const overrideSettings=(selected,patch)=>setSettingsOverrides(previous=>({...previous,[batchModelKey(selected)]:{...(previous[batchModelKey(selected)]||{}),...patch}}));

  const isMulti = runModels.length > 1;
  const canRun = runModels.length > 0;
  const selectedInList = hasModel && batchModels.some(m => batchModelKey(m) === batchModelKey(model));
  const selectedCount = selectedPrompts.length;
  const selectedPlans = selectedPrompts.map(prompt => ({prompt, stages: progressivePlan(prompt)})).filter(plan => plan.stages.length);
  const progressiveActive = mode === 'quick' && progressive && selectedPlans.length > 0;
  const shouldSkip = (prompt, selectedModel) => {
    if (!skipExisting) return false;
    try { return !!deps.hasExistingForModel?.(prompt, selectedModel); } catch { return false; }
  };
  const plannedCalls = ['quick','comparison'].includes(mode) ? runModels.reduce((total, selectedModel) => total + selectedPrompts.reduce((count, prompt) => {
    if (shouldSkip(prompt, selectedModel)) return count;
    return count + (mode === 'quick' && progressive ? progressivePlan(prompt).length || 1 : 1);
  }, 0), 0) : null;
  const stageTokenLimit = (stage, report) => {
    const configured = report.settings?.params.max_tokens ?? report.settings?.params.max_completion_tokens;
    const selectedProfile = settingsOverrides[batchModelKey(report.model)]?.profile || settingsProfile;
    if (selectedProfile !== 'code') return configured;
    const selectedBudget = settingsOverrides[batchModelKey(report.model)]?.totalTokens ?? totalTokens;
    return Math.min(...[stage.maxTokens, configured, selectedBudget].filter(value => Number.isSafeInteger(value) && value > 0));
  };

  const alreadyRunCount = useMemo(() => {
    let n = 0;
    for (const m of runModels) {
      for (const p of selectedPrompts) {
        try { if (deps.hasExistingForModel?.(p, m)) n++; } catch (e) { /* ignore */ }
      }
    }
    return n;
  }, [selectedPrompts, runModels, deps]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && phase !== 'running' && presentation === 'modal') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, presentation, onClose]);

  const toggleOne = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Bulk actions apply to the displayed results without touching other choices.
  const selectAll = useCallback(() => setSelectedIds(prev => setVisibleSelection(prev,visiblePrompts,true)),[visiblePrompts]);
  const selectNone = useCallback(() => setSelectedIds(prev => setVisibleSelection(prev,visiblePrompts,false)),[visiblePrompts]);

  useEffect(() => {
    if (phase !== 'running') return;
    const contexts = new Map(costCalls.filter(call => call.telemetryId).map(call =>
      [call.telemetryId, {index:call.index, title:journalRunListRef.current[call.index]?.title}]));
    journalRef.current?.observeCalls(liveCalls, rateClock, contexts);
    syncJournal();
  }, [liveCalls, rateClock, phase, syncJournal, costCalls]);

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
          stage: event.stage || cur.stage,
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
      const options=batchGenerationOptions({mode,profile:settingsProfile,override:settingsOverrides[batchModelKey(report.model)],budget:{totalTokens,reasoningTokens}});
      const shown=previewReports.find(r=>batchModelKey(r.model)===batchModelKey(report.model))?.settings;
      return {...report.model,generationOptions:{...options,
        reviewedMaxTokens:shown?.params.max_tokens??shown?.params.max_completion_tokens??report.settings.params.max_tokens??report.settings.params.max_completion_tokens}};
    });
    const plan = planBatchLanes({ prompts: list, models: configured, runId });
    configuredModelsRef.current = plan.lanes.map(lane => lane.model);
    retrySummariesRef.current = [];
    setRetryReview(null);
    mainRunningRef.current = true;
    const startedAt = Date.now();
    journalStartedAtRef.current = startedAt;
    setBatchFinishedAt(null);
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

    // A task is one prompt or a model's whole list, depending on concurrency.
    // Its events retain their absolute positions in the model-grouped list.
    let safetyTripped=false;
    const runOne = async (lane, { shouldStop, onFailure }) => {
      runningLanesRef.current += 1;
      try {
        const result=await runBatch({
          prompts: lane.prompts,
          model: lane.model,
          options: {
            mode,
            resumeFrom,
            progressive,
            heal: mode === 'runtime-heal',
            healAttempts,
            maxRepairRounds,
            saveBothOnHeal,
            skipExisting: resumeFrom ? false : skipExisting,
            delayMs: Math.max(0, Math.round(delaySec * 1000)),
            apiRetries,
            stopOnFailure:spendProtection,
            runId: lane.model.batchRunId,
          },
          deps,
          onEvent: (event) => {
            if (event.type === 'done') return;
            handleEvent({ ...event, model:lane.model, index:typeof event.index === 'number' ? event.index + lane.offset : lane.offset });
            if (event.type === 'item' && ['error', 'no_progress'].includes(event.status)) onFailure();
          },
          shouldStop,
          shouldPause: () => pauseRequestedRef.current,
          waitIfPaused: waitAtPauseBoundary,
        });
        if (result?.stopped) setItems(rows => rows.map((row, index) =>
          index >= lane.offset && index < lane.offset + lane.prompts.length && row.status === 'queued'
            ? {...row, status:'not-started'} : row));
        return result;
      } catch (e) {
        onFailure();
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
      const summaries = await runLanes({
        lanes: plan.lanes, mode: laneMode, runOne,
        shouldStop: () => stopRef.current, stopOnFailure: spendProtection,
        onFailure: (lane) => {
          safetyTripped = true;
          const scope = laneMode === 'all-parallel'
            ? `${lane.prompts[0].title} · ${lane.model.label || lane.model.modelId}. Les autres projets et modèles continuent.`
            : `${lane.model.label || lane.model.modelId}. Les autres modèles continuent.`;
          journalRef.current?.event({type:'control',message:`Protection des dépenses : arrêt des nouveaux appels pour ${scope} Les résultats enregistrés peuvent être repris.`});
          syncJournal();
        },
      });
      setSummary(applyRetrySummaries({...combineSummaries(summaries.filter(Boolean)),protectionStopped:safetyTripped}, retrySummariesRef.current));
      setItems(rows=>rows.map((row,index)=>row.status==='queued' && !retryQueueRef.current.has(index)?{...row,status:'not-started'}:row));
    } catch (e) {
      addToast('Erreur d’exécution par lot : ' + e.message, 'error');
    } finally {
      mainRunningRef.current = false;
      startingRef.current=false;
      if (retryQueueRef.current.size === 0) {
      pauseRequestedRef.current = false;
      releasePaused();
      setPauseState('running');
      setPauseContext(null);
      setActiveIndex(-1);
      setBatchFinishedAt(Date.now());
      setPhase('done');
      }
    }
  }, [canRun, hasDirectory, selectedPrompts, runModels, laneMode, mode, progressive, healAttempts, maxRepairRounds, saveBothOnHeal,
      skipExisting, delaySec, apiRetries, spendProtection, totalTokens, reasoningTokens, settingsProfile, settingsOverrides, apiCatalogue, allModels, showLiveOutput, runId, deps, refreshCapabilities, handleEvent, waitAtPauseBoundary, addToast, resumeFrom]);

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

  const doneCount = items.filter(it => ['saved', 'saved-unverified', 'skipped', 'error', 'stopped', 'verified', 'warned', 'no_progress'].includes(it.status)).length;
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
    ? batchLiveStatus(liveCalls, runModels[runList[inspectedIndex]?.laneIndex ?? 0], rateClock,
      costCalls.filter(call => call.index === inspectedIndex).map(call => call.telemetryId).filter(Boolean)) : null;
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
    if (index < 0 || (!outputs[index] && !batchItemRunning(items[index]) && items[index]?.status !== 'error')) return;
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

  const prepareResume = async index => {
    try {
      const saved = await deps.load(items[index]?.savedIds?.at(-1));
      setResumeFrom(prepareGenerationResume(saved, prompts));
      setMode('automatic'); setPhase('config'); onRestore?.();
    } catch (error) { addToast(error.message, 'error'); }
  };
  const prepareNewRun = () => {
    setRetryReview(null);
    setResumeFrom(null);
    setMode(DEFAULT_BATCH_MODE);
    setPhase('config');
    onRestore?.();
  };

  const reviewRetry = index => {
    const item = items[index];
    if (!item || !['error','stopped','not-started'].includes(item.status) || retryQueueRef.current.has(index)) return;
    const selectedModel = configuredModelsRef.current[runList[index].laneIndex || 0];
    const report = outputStats[index]?.settings;
    const maximum = selectedModel?.generationOptions?.reviewedMaxTokens || report?.maxOutputTokens || 128000;
    const proposal = retryProposal(item.message, maximum);
    setRetryTokens(proposal.maximum);
    setRetryReview({index, ...proposal});
    onRestore?.();
  };

  const launchRetry = async () => {
    if (!retryReview) return;
    const {index, maximum} = retryReview;
    const previous = items[index];
    if (!previous || !['error','stopped','not-started'].includes(previous.status) || retryQueueRef.current.has(index)) return;
    let selectedModel;
    try {
      selectedModel = manualRetryModel(configuredModelsRef.current[runList[index].laneIndex || 0], Number(retryTokens), maximum, crypto.randomUUID().replaceAll('-', ''));
    } catch (error) { addToast(error.message, 'error'); return; }
    setRetryReview(null);
    if (phase !== 'running') {
      stopRef.current = false;
      deps.beginRun?.();
    }
    setPhase('running'); setBatchFinishedAt(null);
    setItems(rows => rows.map((row, i) => i === index ? {...row, status:'queued', message:''} : row));
    journalRef.current?.event({type:'control',message:`Relance manuelle de ${selectedModel.label || selectedModel.modelId} · ${runList[index].title} · effort maximal · plafond ${retryTokens} tokens · un seul appel.`});
    syncJournal();
    try {
      await retryQueueRef.current.run(index, async () => {
        runningLanesRef.current++;
        try {
          const result = await runBatch({prompts:[runList[index]], model:selectedModel,
            options:{mode:'comparison', progressive:false, apiRetries:0, skipExisting:false, runId:selectedModel.batchRunId}, deps,
            shouldStop:() => stopRef.current, shouldPause:() => pauseRequestedRef.current, waitIfPaused:waitAtPauseBoundary,
            onEvent:event => {if (event.type !== 'done') handleEvent({...event, model:selectedModel, index});}});
          const adjustment = {result, wasError:previous.status === 'error'};
          retrySummariesRef.current.push(adjustment);
          if (!mainRunningRef.current) setSummary(current => applyRetrySummaries(current, [adjustment]));
        } catch(error) {
          handleEvent({type:'item', status:'error', index, model:selectedModel, message:error.message});
        } finally { runningLanesRef.current--; }
      });
    } finally {
      if (!mainRunningRef.current && retryQueueRef.current.size === 0) {
        pauseRequestedRef.current=false; releasePaused(); setPauseState('running');
        setActiveIndex(-1); setBatchFinishedAt(Date.now()); setPhase('done');
      }
    }
  };

  const retryAllowed = index => !items[index]?.savedIds?.length && ['error','stopped','not-started'].includes(items[index]?.status);
  const renderRetryReview = () => retryReview && html`<section class="batch-retry-review" aria-label="Relancer une génération">
    <strong>Relancer ce modèle · ${runList[retryReview.index]?.modelLabel}</strong>
    <p>${runList[retryReview.index]?.title}</p>
    <p class="batch-error-detail">${items[retryReview.index]?.message}</p>
    ${retryReview.affordable && html`<p>Crédit insuffisant pour ${retryReview.maximum.toLocaleString('fr-FR')} tokens. OpenRouter annonçait ${retryReview.affordable.toLocaleString('fr-FR')} tokens possibles ; après recharge, gardez le plafond maximal. Le solde peut changer pendant les autres appels.</p><button class="btn btn-sm" onClick=${()=>setRetryTokens(retryReview.recommended)}>Adapter au dernier crédit annoncé (marge de 5 %)</button>`}
    <label>Plafond de sortie de cette relance (raisonnement compris)
      <input class="form-input" type="number" min="256" max=${retryReview.maximum} value=${retryTokens} onInput=${event=>setRetryTokens(event.target.value)} />
    </label>
    <p>Effort maximal conservé. Un seul appel pour cette ligne ; les autres modèles et résultats sont conservés. Cette relance peut être facturée.</p>
    <div class="batch-output-tabs"><button class="btn" onClick=${()=>setRetryReview(null)}>Annuler la relance</button>
      <button class="btn btn-primary" onClick=${launchRetry}>Confirmer et relancer ce modèle</button></div>
  </section>`;

  // ── Renderers ──

  const renderConfig = () => html`
    <div class="modal-body batch-config">
      ${resumeFrom && html`<section class="batch-prompt-selection" aria-label="Reprise du résultat enregistré">
        <strong>Reprendre : ${resumeFrom.prompt.title}</strong>
        <p>${resumeFrom.model.label} · ${resumeFrom.html.length.toLocaleString('fr-FR')} caractères conservés.</p>
        <p>La reprise utilise le code enregistré, sans nouvelle génération initiale. Les corrections peuvent être facturées. L’original reste disponible ; chaque résultat corrigé est une nouvelle version.</p>
      </section>`}
      ${!resumeFrom && html`
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
          <div class="batch-options batch-lane-modes" role="radiogroup" aria-label="Mode d’exécution des projets et modèles">
            <label class="batch-opt batch-mode-opt">
              <input type="radio" name="batch-lane-mode" value="all-parallel" checked=${laneMode === 'all-parallel'} onChange=${() => setLaneMode('all-parallel')} />
              <span><strong>Tous les projets et modèles simultanément</strong><small>Chaque prompt démarre sur chaque modèle sans attendre les autres projets. Les réglages de qualité restent identiques.</small></span>
            </label>
            <label class="batch-opt batch-mode-opt">
              <input type="radio" name="batch-lane-mode" value="parallel" checked=${laneMode === 'parallel'} onChange=${() => setLaneMode('parallel')} />
              <span><strong>Modèles simultanés, projets successifs</strong><small>Chaque modèle traite un seul prompt à la fois, puis passe au suivant.</small></span>
            </label>
            <label class="batch-opt batch-mode-opt">
              <input type="radio" name="batch-lane-mode" value="sequential" checked=${laneMode === 'sequential'} onChange=${() => setLaneMode('sequential')} />
              <span><strong>L’un après l’autre</strong><small>Terminer un modèle avant le suivant. Utile lorsque les modèles partagent le même GPU local.</small></span>
            </label>
          </div>
          ${laneMode === 'all-parallel' && html`<div class="batch-note">${selectedPrompts.length * runModels.length} génération(s) prévue(s) en parallèle. Les limites de connexion du navigateur et du fournisseur peuvent mettre des requêtes en attente.</div>`}
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
          <span><i class="fa-solid fa-list-check"></i> Prompts (${selectedCount} sélectionné(s) au total)</span>
          <span class="batch-select-actions">
            <button class="btn btn-xs" onClick=${selectAll} title="Sélectionner tous les prompts affichés">Tout cocher ici</button>
            <button class="btn btn-xs" onClick=${selectNone} title="Désélectionner tous les prompts affichés">Tout décocher ici</button>
          </span>
        </div>
        ${availableSets.length > 1 && html`
          <div class="batch-set-switch" role="group" aria-label="Série de prompts">
            ${availableSets.map(s => html`
              <button
                key=${s.id}
                type="button"
                class=${`library-cat-chip ${promptChoices.effectiveSet === s.id ? 'active' : ''}`}
                aria-pressed=${promptChoices.effectiveSet === s.id}
                title=${s.hint}
                onClick=${() => {setPromptSet(s.id);setPromptSearch('');}}
              ><i class=${`fa-solid ${s.icon}`}></i>${s.label}<span class="batch-set-count">${s.id === 'all' ? selectedCount : promptChoices.selectedBySet[s.id]||0}/${s.count}</span></button>
            `)}
            ${activeSetMeta?.hint && html`<span class="batch-set-hint">${activeSetMeta.hint}. Vous pouvez réunir plusieurs catégories dans le même lot.</span>`}
          </div>
        `}
        <div class="batch-prompt-search">
          <label for="batch-prompt-search">Rechercher dans tous les prompts</label>
          <div class="batch-prompt-search-input">
            <input id="batch-prompt-search" class="form-input" type="search" value=${promptSearch} maxLength="200"
              placeholder="Titre, nom d’origine, description ou étiquette…" onInput=${e => setPromptSearch(e.target.value)} />
            ${promptSearch && html`<button class="btn btn-sm" onClick=${() => setPromptSearch('')}>Effacer la recherche</button>`}
          </div>
          <div class="batch-search-summary" role="status">${promptSearch.trim()
            ? `${visiblePrompts.length} résultat(s) dans toute la bibliothèque (${prompts.length} prompts).`
            : `${visiblePrompts.length} prompt(s) affiché(s) sur ${prompts.length} dans la bibliothèque${promptChoices.effectiveSet === 'all' ? '.' : ` · filtre : ${activeSetMeta?.label || promptSet}.`}`}
            ${' '}La sélection du lot est conservée quand vous changez de filtre.</div>
        </div>
        <div class="batch-prompt-list">
          ${visiblePrompts.length === 0
            ? html`<div class="batch-empty">${promptSearch.trim() ? 'Aucun résultat dans la bibliothèque.' : 'Aucun prompt à exécuter dans cette série.'}</div>`
            : visiblePrompts.map(p => html`
              <label class="batch-prompt-row" key=${p.id}>
                <input type="checkbox" aria-label=${p.title} checked=${selectedIds.has(p.id)} onChange=${() => toggleOne(p.id)} />
                <span class="batch-prompt-title" title=${p.title}>${p.title}</span>
                ${promptChoices.effectiveSet === 'all' && html`<span class="batch-prompt-badge">${promptSetLabel(promptSetOf(p))}</span>`}
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

      <section class="batch-prompt-selection" aria-label="Prompts sélectionnés pour le lot">
        <div class="batch-section-head"><strong>Sélection du lot : ${selectedCount} prompt(s)</strong>
          <button class="btn btn-xs" disabled=${!selectedCount} onClick=${()=>setSelectedIds(new Set())}>Vider la sélection</button></div>
        ${selectedCount?html`<p>Tous les prompts ci-dessous seront exécutés, quelle que soit la catégorie ou la recherche affichée.</p>
          <ul>${selectedPrompts.map(p=>html`<li key=${p.id}><span class="batch-selection-set">${promptSetLabel(promptSetOf(p))}</span><span>${p.title}</span>
            <button class="btn btn-xs" aria-label=${`Retirer ${p.title} de la sélection`} onClick=${()=>toggleOne(p.id)}>Retirer</button></li>`)}</ul>`
          :html`<p>Cochez les prompts à tester dans la bibliothèque complète ou recherchez-les par titre et description. Vous pouvez mélanger toutes les séries.</p>`}
      </section>

      `}
      <div class="batch-section">
        <div class="batch-section-head"><span><i class="fa-solid fa-wand-magic-sparkles"></i> Mode de génération</span></div>
        <div class="batch-options">
          ${!resumeFrom && html`<label class="batch-opt batch-mode-opt">
            <input type="radio" name="batch-mode" value="comparison" checked=${mode === 'comparison'} onChange=${() => setMode('comparison')} />
            <span><strong>Comparaison — capacité maximale</strong><small>Prompt complet identique, sortie maximale et effort le plus élevé accepté par chaque modèle. Un seul appel par prompt et modèle.</small></span>
          </label>`}
          ${mode === 'comparison' && html`<section class="batch-prompt-selection" aria-label="Protocole de comparaison">
            <strong>Évaluer le résultat initial de chaque modèle à son effort maximal.</strong>
            <p>Les anciens réglages économes et les réductions apprises après un échec ne sont pas appliqués. Le prompt reste complet : aucune construction par étapes, correction ou relance automatique. Le code reçu est enregistré pour être évalué.</p>
            <p>${laneMode === 'all-parallel' ? 'Tous les prompts démarrent sur tous les modèles sans attendre la fin des autres projets.' : laneMode === 'parallel' ? 'Les modèles démarrent ensemble ; chaque modèle termine un prompt avant le suivant.' : 'Les modèles et leurs prompts passent l’un après l’autre.'} Le nombre de générations simultanées ne modifie pas l’effort demandé.</p>
          </section>`}
          <label class="batch-opt batch-mode-opt">
            <input type="radio" name="batch-mode" value="automatic" checked=${mode === 'automatic'} onChange=${() => setMode('automatic')} />
            <span><strong>Automatique — reprises adaptatives</strong><small>Vérification du code et reprises selon l’erreur. L’effort peut être réduit selon les échecs précédents.</small></span>
          </label>
          ${mode === 'automatic' && html`<section class="batch-prompt-selection" aria-label="Fonctionnement automatique">
            <strong>Choisis tes modèles et tes prompts, puis lance le lot.</strong>
            <p>Sortie maximale annoncée par OpenRouter. L’effort tient compte des échecs déjà observés et peut être faible dès le premier appel. Si le raisonnement épuise la sortie, l’effort peut être réduit pour la reprise. Si du code existe, il sert de point de départ aux corrections.</p>
            <p><strong>Maximum 3 appels par prompt et modèle, corrections et relances comprises.</strong> Chaque appel peut être facturé. Saturation ou coupure : attente et reprise. Erreur de clé, crédit insuffisant ou filtrage : arrêt expliqué. Aucun changement de modèle. Les autres modèles continuent.</p>
            <p>La vérification automatique détecte les erreurs du bac à sable ; elle ne certifie pas toutes les fonctionnalités ni la qualité visuelle. Chaque adaptation et son coût sont consignés dans le journal.</p>
          </section>`}
          ${!resumeFrom && html`
          <label class="batch-opt batch-mode-opt">
            <input type="radio" name="batch-mode" value="quick" checked=${mode === 'quick'} onChange=${() => setMode('quick')} />
            <span><strong>Rapide</strong><small>Générer directement, ou construire par étapes les prompts compatibles.</small></span>
          </label>
          <label class="batch-opt batch-mode-opt">
            <input type="radio" name="batch-mode" value="runtime-heal" checked=${mode === 'runtime-heal'} onChange=${() => setMode('runtime-heal')} />
            <span><strong>Correction des erreurs</strong><small>Vérifier le bac à sable et corriger les erreurs d’exécution capturées.</small></span>
          </label>
          `}
          <label class="batch-opt batch-mode-opt">
            <input type="radio" name="batch-mode" value="verified"
              checked=${mode === 'verified'} onChange=${() => setMode('verified')} />
            <span><strong>Vérifié</strong><small>Évaluer les exigences du prompt à partir des observations du bac à sable.</small></span>
          </label>
          ${mode === 'quick' && html`<label class="batch-opt">
            <input type="checkbox" checked=${progressive} onChange=${e => setProgressive(e.target.checked)} />
            <span>Construire le prompt GTA VI par étapes, avec un appel par étape</span>
          </label>
          <p class="batch-opt-hint">La première étape vise une version jouable ; les suivantes l’enrichissent. Chaque étape terminée est enregistrée. Au premier échec, la construction s’arrête et les versions déjà enregistrées restent disponibles. Le résultat final n’est pas garanti. Décochez pour envoyer le prompt d’origine en un appel.</p>`}
          ${progressiveActive && html`<section class="batch-prompt-selection" aria-label="Appels prévus pour la construction par étapes">
            <strong>${plannedCalls} appel${plannedCalls === 1 ? '' : 's'} prévu${plannedCalls === 1 ? '' : 's'} pour ce lot</strong>
            <p>Un appel par étape et par modèle, plus un appel par prompt sans étapes. Les prompts ignorés sont exclus. Un arrêt ou un échec peut réduire ce nombre. Chaque appel peut être facturé.</p>
            ${selectedPlans.map(({prompt, stages}) => html`<div key=${prompt.id}>
              <strong>${prompt.title} · ${stages.length} étapes par modèle</strong>
              <ol>${stages.map(stage => html`<li key=${stage.id}>${stage.title} · plafond OpenRouter ${stage.maxTokens.toLocaleString('fr-FR')} tokens</li>`)}</ol>
            </div>`)}
            <p>Sur OpenRouter, ces plafonds incluent raisonnement et code. Une limite API ou un réglage individuel plus bas reste prioritaire. Les autres fournisseurs conservent leurs réglages natifs : les plafonds du plan ne leur sont pas appliqués.</p>
            <p>Sur OpenRouter, les étapes respectent le profil choisi. Seul le profil Économe réduit le plafond de sortie et le raisonnement.</p>
            <ul>${previewReports.map(report => html`<li key=${batchModelKey(report.model)}>${report.model.label || report.model.modelId} : ${report.error ? 'réglages à corriger avant le lancement' : report.isOpenRouter ? `jusqu’à ${stageTokenLimit({maxTokens:Math.max(...selectedPlans.flatMap(plan => plan.stages.map(stage => stage.maxTokens)))}, report).toLocaleString('fr-FR')} tokens par étape` : 'réglages natifs du fournisseur ; plafonds du plan non appliqués'}</li>`)}</ul>
          </section>`}
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
          ${mode !== 'automatic' && html`
          <label class="batch-opt">
            <span>Nouvelles tentatives après erreur de connexion</span>
            <select class="form-input batch-num" disabled=${spendProtection || mode === 'comparison'} value=${spendProtection || mode === 'comparison'?0:apiRetries} onChange=${(e) => setApiRetries(Number(e.target.value))}>
              ${[0, 1, 2, 3].map(n => html`<option key=${n} value=${n}>${n}</option>`)}
            </select>
          </label>
          <div class="batch-opt-hint">Les nouvelles tentatives sont désactivées par défaut. Une réponse vide ou incomplète ne sera jamais relancée automatiquement.</div>
          <label class="batch-opt"><input type="checkbox" checked=${spendProtection} onChange=${e=>setSpendProtection(e.target.checked)}/><span>Protection des dépenses : arrêter uniquement ${laneMode === 'all-parallel' ? 'le projet du modèle' : 'le modèle'} en échec, sans nouvelle tentative automatique</span></label>
          ${spendProtection && laneMode !== 'sequential' && html`<div class="batch-note">Les autres ${laneMode === 'all-parallel' ? 'projets et modèles' : 'modèles'} continuent leurs générations, vérifications et corrections. Les versions déjà enregistrées sont conservées.</div>`}
          <p class="batch-opt-hint">Un appel interrompu, vide ou filtré peut rester facturé. Les coûts affichés viennent de l’API. Les relances après un échec sont bloquées dans ce navigateur et dans le serveur local, même après actualisation.</p>
          <button class="btn btn-sm" onClick=${async()=>{try{await clearFailedGenerationBlocks();addToast('Relances autorisées : un nouvel appel pourra être facturé.','info');}catch(error){addToast(error.message,'error');}}}>Autoriser les relances après échec (nouveau coût possible)</button>
          ${mode !== 'comparison' && html`<label class="batch-opt"><span>Adaptation aux capacités API</span>
            <select class="form-input" value=${settingsProfile} onChange=${e=>{setSettingsProfile(e.target.value);setSettingsOverrides({});}}>
              <option value="benchmark">Comparaison — sortie maximale et effort très élevé</option><option value="maximum">Effort maximal — risque de coût élevé</option><option value="code">Économe — sortie limitée et raisonnement réduit</option><option value="manual">Budget personnalisé — plafonné par l’API</option>
            </select></label>
          <p class="batch-opt-hint">Le profil Comparaison utilise la sortie maximale de chaque modèle et un effort très élevé, ou élevé selon les capacités API. Le profil Effort maximal utilise le niveau le plus élevé annoncé. Le profil Économe réduit le raisonnement et la sortie. Les réglages effectifs sont affichés ci-dessous ; les modèles peuvent avoir des limites différentes. Un plafond élevé autorise des appels plus longs et plus coûteux sans imposer de tout consommer. Aucun appel payant n’est lancé par l’actualisation.</p>
          ${settingsProfile==='manual'&&html`<label class="batch-opt"><span>Budget total demandé par appel</span><input class="form-input" type="number" min="1" value=${totalTokens} onInput=${e=>{const value=Number(e.target.value);if(Number.isSafeInteger(value)&&value>0)setTotalTokens(value);}}/></label>
            <label class="batch-opt"><span>Budget de raisonnement demandé (si l’API l’accepte)</span><input class="form-input" type="number" min="1" value=${reasoningTokens} onInput=${e=>{const value=Number(e.target.value);if(Number.isSafeInteger(value)&&value>0)setReasoningTokens(value);}}/></label>`}
          ${progressiveActive && html`<p class="batch-opt-hint">Les étapes GTA VI respectent le profil Comparaison, Effort maximal ou les réglages personnalisés ci-dessous. Le plafond réduit par étape s’applique uniquement au profil Économe. La construction par étapes change le protocole : utilisez le même mode pour tous les modèles comparés.</p>`}`}
          <${ModelSettingsPanel} reports=${previewReports} loading=${settingsLoading} error=${settingsError}
            readOnly=${mode === 'comparison'}
            onRefresh=${()=>refreshCapabilities().catch(()=>{})} onOverride=${overrideSettings} onReset=${()=>setSettingsOverrides({})}/>
          `}
          ${mode === 'automatic' && html`<details><summary>Réglages initiaux des modèles</summary>
            ${previewReports.map(report=>html`<p>${report.model.label || report.model.modelId} : ${report.error || (report.settings ? `${(report.settings.params.max_tokens??report.settings.params.max_completion_tokens).toLocaleString('fr-FR')} tokens de sortie maximum · effort ${report.settings.params.reasoning?.effort || report.settings.params.reasoning_effort || 'budget adapté'}` : 'paramètres natifs du fournisseur')}</p>`)}
          </details>`}
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
        <i class="fa-solid fa-play"></i> ${resumeFrom ? 'Reprendre' : 'Lancer'} ${selectedCount} prompt${selectedCount === 1 ? '' : 's'}${isMulti ? ` × ${runModels.length} modèles` : ''}${mode==='automatic'?` · jusqu’à ${selectedCount*runModels.length*3} appels`:plannedCalls !== null ? ` · ${plannedCalls} appel${plannedCalls === 1 ? '' : 's'} prévu${plannedCalls === 1 ? '' : 's'}` : ''}
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

  const renderRunControls = () => html`
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

      <${BatchCosts} calls=${costCalls} startedAt=${journalStartedAtRef.current} />
      ${renderRetryReview()}
      <div class="batch-note">${laneMode === 'all-parallel' ? 'Les projets et les modèles tournent en parallèle.' : laneMode === 'sequential' ? 'Les modèles passent l’un après l’autre.' : 'Les modèles tournent en parallèle ; leurs projets passent l’un après l’autre.'} Sélectionnez une ligne pour changer l’aperçu et le flux HTML affichés.</div>

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
            const canInspect = it.status === 'error' || showLiveOutput && (!!outputs[idx] || isActive);
            const canOpenFullscreen = isActive || !!outputs[idx] || !!it.savedIds?.length;
            const rowLive = it.status === 'generating'
              ? batchLiveStatus(liveCalls, runModels[p.laneIndex ?? 0], rateClock,
                costCalls.filter(call => call.index === idx).map(call => call.telemetryId).filter(Boolean)) : null;
            return html`
              <div
                class=${`batch-run-item ${m.cls} ${isActive ? 'is-active' : ''} ${isInspected ? 'is-inspected' : ''} ${canInspect ? 'is-inspectable' : ''}`}
                key=${p.runKey || p.id}
                role=${canInspect ? 'button' : undefined}
                tabIndex=${canInspect ? 0 : undefined}
                aria-current=${isInspected ? 'true' : undefined}
                title=${it.status === 'error' ? it.message : canInspect ? (isActive ? 'Voir la génération en direct' : 'Examiner cette génération pendant l’exécution du lot') : ''}
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
                <span class="batch-run-cost">${it.status==='not-started'?'Aucun appel':generationCostLabel(idx)}</span>
                <span class="batch-run-status">
                  ${it.stage ? html`<span title=${it.stage.title}>Étape ${it.stage.index}/${it.stage.total} · ${it.stage.title} · </span>` : null}
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
                ${retryAllowed(idx) && html`<button class="btn btn-xs" onClick=${event=>{event.stopPropagation();reviewRetry(idx);}}>Relancer ce modèle</button>`}
              </div>
            `;
          })}
          <div ref=${listEndRef}></div>
          ${items[inspectedIndex]?.status === 'error' && html`<p class="batch-error-detail" role="alert">${items[inspectedIndex].message}</p>`}
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
                ? html`<iframe class="batch-preview-frame" sandbox="allow-scripts" srcdoc=${withPreviewStorage(displayedHtml)} title=${`Aperçu : ${inspectedTitle || 'génération en cours'}`}></iframe>`
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
        <${BatchActivity} model=${runModels[runList[inspectedIndex]?.laneIndex ?? 0]} index=${inspectedIndex}
          calls=${costCalls.filter(call => call.index === inspectedIndex)} liveCalls=${liveCalls} entries=${logEntries} now=${rateClock}
          statusLabel=${liveStatus?.label || STATUS_META[items[inspectedIndex]?.status]?.label || 'En attente'}/>
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

    ${renderRunControls()}
  `;

  const renderDone = () => html`
    <div class="modal-body batch-done">
      <div class="batch-summary">
        <div class="batch-summary-icon"><i class="fa-solid fa-flag-checkered"></i></div>
        <div class="batch-summary-grid">
          ${runIsMulti ? html`<div class="batch-stat"><strong>${summary?.lanes || 0}</strong><span>modèles</span></div>` : null}
          <div class="batch-stat"><strong>${summary?.generated || 0}</strong><span>générés</span></div>
          ${summary?.resumed ? html`<div class="batch-stat"><strong>${summary.resumed}</strong><span>repris</span></div>` : null}
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
        ${summary?.stopped ? html`<div class="batch-note"><i class="fa-solid fa-hand"></i> ${summary.protectionStopped?'Protection des dépenses : les tâches en échec ont été arrêtées indépendamment. Les autres ont pu continuer. Les résultats enregistrés restent disponibles.':'Exécution interrompue.'}</div>` : null}
      </div>

      <${BatchCosts} calls=${costCalls} done=${true} startedAt=${journalStartedAtRef.current} finishedAt=${batchFinishedAt} />
      ${renderRetryReview()}
      <div class="batch-run-list batch-run-list-done">
        ${runList.map((p, idx) => {
          const it = items[idx] || { status: 'queued' };
          const m = STATUS_META[it.status] || STATUS_META.queued;
          return html`
            <div class=${`batch-run-item ${m.cls}`} key=${p.runKey || p.id}>
              <i class=${`batch-run-icon fa ${m.icon}`}></i>
              <span class="batch-run-title" title=${rowTitle(p)}>${p.title}${runIsMulti && p.modelLabel ? html`<span class="batch-run-model">${p.modelLabel}</span>` : null}</span>
              <span class="batch-run-cost">${it.status==='not-started'?'Aucun appel':generationCostLabel(idx)}</span>
                <span class="batch-run-status">
                ${m.label}${it.healed ? html` <span class="batch-healed-chip">corrigé</span>` : null}
                ${it.stage ? html`<span> · Étape ${it.stage.index}/${it.stage.total} : ${it.stage.title}</span>` : null}
                ${it.stage && it.status !== 'saved' && it.savedIds?.length ? html`<span> · ${it.savedIds.length} version(s) conservée(s)</span>` : null}
                ${it.repairRound ? html` <span class="batch-healed-chip">${it.repairRound} correction${it.repairRound === 1 ? '' : 's'}</span>` : null}
                ${it.status === 'error' && it.message ? html`<span class="batch-run-err" title=${it.message}> — ${it.message}</span>` : null}
                ${it.savedIds?.length ? html`
                  <button class="btn btn-xs" onClick=${() => prepareResume(idx)}>Reprendre / corriger</button>
                  <button class="batch-fullscreen-button" title="Ouvrir la génération interactive en plein écran"
                    onClick=${() => openFullscreen(idx)}><i class="fa-solid fa-expand"></i></button>` : null}
                ${retryAllowed(idx) && html`<button class="btn btn-xs" onClick=${() => reviewRetry(idx)}>Relancer ce modèle</button>`}
              </span>
            </div>
          `;
        })}
      </div>
      ${renderJournal(true)}
    </div>

    <div class="modal-footer">
      <button class="btn" onClick=${prepareNewRun}><i class="fa-solid fa-rotate-left"></i> Nouvelle exécution</button>
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

  const renderComparison = () => {
    const totals = costTotals(costCalls);
    const timing = executionMetrics(costCalls, {now:rateClock, done:phase === 'done', startedAt:journalStartedAtRef.current, finishedAt:batchFinishedAt});
    const confirmedCost = totals.confirmedUsd == null
      ? phase === 'done' ? 'Coût non communiqué' : 'Coût en attente'
      : `${formatUsd(totals.confirmedUsd)}${totals.missingCosts ? ` + ${totals.missingCosts} coût(s) en attente ou non communiqué(s)` : ''}`;
    return html`
    <section class="batch-live-workspace" aria-label="Suivi du lot en direct">
      <header class="batch-live-header">
        <div><h2>Comparer en direct</h2><p>${doneCount} / ${runList.length} terminé(s) · ${phase === 'done' ? 'Lot terminé' : pauseState === 'paused' ? 'En pause' : 'Lot en cours'}</p></div>
        <div class="batch-window-actions">
          <button class="btn" onClick=${onRestore}>Journal et détails du lot</button>
          <button class="btn" onClick=${onMinimize}>Réduire</button>
          ${phase === 'done' && html`<button class="btn" onClick=${onClose}>Fermer le suivi</button>`}
        </div>
      </header>
      <details class="batch-live-summary">
        <summary>Durée du lot : ${formatDuration(timing.elapsedMs)} · ${totals.requestCount} appel(s) API · Total confirmé : ${confirmedCost} · Détails</summary>
        <${BatchCosts} calls=${costCalls} done=${phase === 'done'} startedAt=${journalStartedAtRef.current} finishedAt=${batchFinishedAt}/>
      </details>
      ${renderRetryReview()}
      <${BatchLiveComparison} models=${logModels} runList=${runList} items=${items} outputs=${outputs} costCalls=${costCalls}
        liveCalls=${liveCalls} entries=${logEntries} now=${rateClock} done=${phase === 'done'} paused=${pauseState === 'paused'} theme=${theme}
        onFullscreen=${openFullscreen} onRetry=${reviewRetry} showLiveOutput=${showLiveOutput}/>
      ${phase === 'running' ? renderRunControls() : html`<div class="modal-footer"><button class="btn" onClick=${prepareNewRun}>Nouvelle exécution</button><button class="btn" onClick=${() => {onOpenGallery?.();onClose();}}>Voir dans la galerie</button></div>`}
    </section>`;
  };

  return html`
    <${Fragment}>
      ${presentation === 'minimized' ? html`
        <aside class="batch-live-dock" aria-label="Lot réduit">
          <span><strong>${phase === 'done' ? 'Lot terminé' : pauseState === 'paused' ? 'Lot en pause' : 'Lot en cours'}</strong> · ${doneCount}/${runList.length} terminé(s)</span>
          <button class="btn btn-primary" onClick=${onOpenComparison}>Comparer en direct</button>
          <button class="btn" onClick=${onRestore}>Ouvrir le lot</button>
        </aside>` : presentation === 'compare' && phase !== 'config' ? renderComparison() : html`<div class="modal-overlay">
        <div class=${`modal batch-dialog ${phase === 'running' ? 'is-running' : ''}`} onClick=${(e) => e.stopPropagation()}>
          <div class="modal-header">
            <h2><i class="fa-solid fa-layer-group"></i> Exécution par lot</h2>
            <div class="batch-window-actions">
            ${phase !== 'config' && onOpenComparison && html`<button class="btn btn-primary btn-sm" onClick=${onOpenComparison}>Comparer en direct</button>`}
            ${phase !== 'config' && onMinimize && html`<button class="btn btn-sm" onClick=${onMinimize}>Réduire</button>`}
            ${phase !== 'running' && html`
              <button class="btn-icon" aria-label="Fermer le lot" onClick=${onClose}><i class="fa-solid fa-xmark"></i></button>
            `}
            </div>
          </div>
          <${Fragment} key=${phase}>${phase === 'config' ? renderConfig() : phase === 'running' ? renderRunning() : renderDone()}</${Fragment}>
        </div>
      </div>`}
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
