import { connectRoot, getRootStatus, setRoot } from './shared/services/data-root-manager.js';
import { browserRoot } from './shared/services/browser-data-root.js';
import { copyStorageInto, summarizeStorage } from './shared/services/browser-storage-copy.js';
import * as modelProviders from './shared/services/model-providers.js';
import { createProvider as createLmStudioProvider } from './shared/services/providers-lmstudio.js';
import {
  createProvider as createUnslothStudioProvider,
  saveApiKey as saveUnslothStudioApiKey,
} from './shared/services/providers-unsloth-studio.js';

const statusBox = document.querySelector('#folder-status');
const statusTitle = document.querySelector('#status-title');
const statusDetail = document.querySelector('#status-detail');
const chooseButton = document.querySelector('#choose-folder');
const browserHelp = document.querySelector('#browser-help');
const storageBox = document.querySelector('#browser-storage');
const storageTitle = document.querySelector('#browser-storage-title');
const storageDetail = document.querySelector('#browser-storage-detail');
const copyButton = document.querySelector('#copy-into-folder');
const copyStatus = document.querySelector('#copy-status');
let folderReady = false;
let folderName = '';
let storedFiles = 0;
const endpointForm = document.querySelector('#model-endpoint-form');
const providerType = document.querySelector('#model-provider-type');
const providerName = document.querySelector('#model-provider-name');
const providerUrl = document.querySelector('#model-provider-url');
const providerKey = document.querySelector('#model-provider-key');
const providerKeyField = document.querySelector('#endpoint-key-field');
const providerList = document.querySelector('#model-provider-list');
const modelStatus = document.querySelector('#model-connect-status');
const addProviderButton = document.querySelector('#add-model-provider');

const LOCAL_PROVIDER_TYPES = new Set(['lmstudio', 'unsloth-studio', 'lemonade']);

function showStatus(kind, title, detail, buttonLabel) {
  statusBox.dataset.status = kind;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
  if (buttonLabel) chooseButton.textContent = buttonLabel;
}

async function refreshStatus() {
  if (typeof window.showDirectoryPicker !== 'function') {
    folderReady = false;
    showStatus(
      'browser',
      'Votre travail est enregistré dans ce navigateur',
      'Les applications conservent votre travail dans le stockage privé du navigateur, sans configuration. L’enregistrement dans un dossier du disque nécessite une version récente de Chrome ou Edge.',
      'Accès aux dossiers indisponible',
    );
    browserHelp.textContent = 'Le stockage appartient à ce site dans ce navigateur. Effacer les données du site dans les paramètres du navigateur le supprime.';
    chooseButton.disabled = true;
    return;
  }

  chooseButton.disabled = false;
  const status = await getRootStatus();
  folderReady = status.status === 'ready';
  folderName = status.name || '';
  if (status.status === 'ready') {
    showStatus('ready', `Enregistrement dans « ${status.name} »`, 'Chaque application utilise son propre sous-dossier. Vous pouvez copier ci-dessous le travail enregistré auparavant dans le navigateur.', 'Changer de dossier');
  } else if (status.status === 'needs-permission') {
    showStatus('attention', `Autorisation nécessaire pour « ${status.name} »`, 'Sélectionnez-le à nouveau ou choisissez un autre dossier de travail.', 'Reconnecter le dossier');
  } else {
    showStatus('browser', 'Votre travail est enregistré dans ce navigateur', 'En attendant le choix d’un dossier, votre travail reste dans le stockage privé du navigateur. Choisissez un dossier pour enregistrer les fichiers sur votre disque.', 'Choisir un dossier');
  }
  // The storage count may have finished first; the button depends on both.
  if (storedFiles) updateCopyButton();
}

// ── Stockage du navigateur → folder ──────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} octets`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

async function refreshBrowserStorage() {
  const root = await browserRoot();
  if (!root) { storageBox.hidden = true; return; }
  const summary = await summarizeStorage(root).catch(() => ({ files: 0, bytes: 0, apps: [] }));
  storedFiles = summary.files;
  if (!summary.files) { storageBox.hidden = true; return; }
  storageBox.hidden = false;
  storageTitle.textContent = `${summary.files} fichier${summary.files === 1 ? '' : 's'} enregistré${summary.files === 1 ? '' : 's'} dans ce navigateur`;
  storageDetail.textContent = `${formatBytes(summary.bytes)} provenant de ${summary.apps.join(', ') || 'vos applications'}.`;
  updateCopyButton();
}

function updateCopyButton() {
  const canCopy = folderReady && storedFiles > 0;
  copyButton.disabled = !canCopy;
  copyButton.textContent = folderReady ? `Copier dans « ${folderName} »` : 'Copier dans un dossier';
  storageBox.dataset.offer = canCopy ? 'true' : 'false';
  if (!folderReady && !copyStatus.textContent) {
    copyStatus.textContent = typeof window.showDirectoryPicker === 'function'
      ? 'Choisissez un dossier ci-dessus, puis copiez-y le travail du navigateur.'
      : 'La copie dans un dossier nécessite Chrome ou Edge.';
  }
}

copyButton.addEventListener('click', async () => {
  copyButton.disabled = true;
  copyStatus.textContent = 'Accès au dossier…';
  try {
    const [source, folder] = await Promise.all([browserRoot(), connectRoot()]);
    if (!source) throw new Error('Le stockage du navigateur est indisponible.');
    if (!folder) throw new Error('Le dossier n’est pas connecté. Sélectionnez-le à nouveau ci-dessus.');
    const report = await copyStorageInto(source, folder, {
      onProgress: ({ done }) => { copyStatus.textContent = `Copie… ${done} sur ${storedFiles}`; },
    });
    const parts = [`${report.copied} fichier${report.copied === 1 ? '' : 's'} copié${report.copied === 1 ? '' : 's'} dans « ${folder.name} ».`];
    if (report.identical) parts.push(`${report.identical} fichier${report.identical === 1 ? '' : 's'} identique${report.identical === 1 ? '' : 's'} déjà présent${report.identical === 1 ? '' : 's'}.`);
    if (report.keptBoth.length) {
      parts.push(`${report.keptBoth.length} fichier(s) différent(s) enregistré(s) à côté de la version du dossier, avec « (from browser) » dans le nom.`);
    }
    if (report.settingsKept) parts.push(`Les paramètres du dossier ont été conservés.`);
    if (report.failed.length) parts.push(`${report.failed.length} n’ont pas pu être copiés : ${report.failed.slice(0, 3).map(f => f.path).join(', ')}${report.failed.length > 3 ? '…' : ''}.`);
    parts.push('La copie du navigateur est conservée.');
    copyStatus.textContent = parts.join(' ');
  } catch (error) {
    copyStatus.textContent = `Copie interrompue : ${error?.message || error}`;
  } finally {
    await refreshStatus().catch(() => {});
    updateCopyButton();
  }
});

chooseButton.addEventListener('click', async () => {
  chooseButton.disabled = true;
  showStatus('working', 'En attente du choix du dossier…', 'Utilisez le sélecteur du système pour choisir ou créer un dossier.', chooseButton.textContent);
  try {
    await setRoot();
    await refreshStatus();
    copyStatus.textContent = '';
    await refreshBrowserStorage();
    if (storedFiles) copyStatus.textContent = `Le travail sera désormais enregistré dans ce dossier. Vos ${storedFiles} fichier(s) précédent(s) restent dans le navigateur : copiez-les avec le bouton ci-dessous.`;
  } catch (error) {
    if (error?.name === 'AbortError') {
      await refreshStatus();
      return;
    }
    showStatus('error', 'Impossible de connecter le dossier', error?.message || 'Veuillez réessayer.', 'Réessayer');
    chooseButton.disabled = false;
  }
});

refreshStatus().catch((error) => {
  showStatus('error', 'Impossible de lire l’état du dossier', error?.message || 'Actualisez la page puis réessayez.', 'Réessayer');
  chooseButton.disabled = false;
});
refreshBrowserStorage().catch(() => { storageBox.hidden = true; });

function setModelStatus(kind, message) {
  modelStatus.dataset.status = kind || '';
  modelStatus.textContent = message || '';
}

function localProviderEntries() {
  return modelProviders.getProviders().filter(provider => LOCAL_PROVIDER_TYPES.has(provider.type));
}

async function testLocalProvider(provider, statusNode) {
  statusNode.dataset.status = 'working';
  statusNode.textContent = 'Test de connexion…';
  const result = await modelProviders.testConnection(provider);
  if (!result.ok) {
    statusNode.dataset.status = 'error';
    statusNode.textContent = result.error || 'Échec de la connexion';
    return false;
  }

  let modelCount = result.modelCount || 0;
  try {
    const models = await modelProviders.refreshProviderModels(provider.id);
    modelCount = models.length || modelCount;
  } catch {
    // The connection test succeeded; model refresh errors are shown when the
    // user opens a gallery model picker, so do not turn success into failure.
  }
  statusNode.dataset.status = 'ready';
  statusNode.textContent = `Connecté${modelCount ? ` — ${modelCount} modèle${modelCount === 1 ? '' : 's'} trouvé${modelCount === 1 ? '' : 's'}` : ''}`;
  return true;
}

function renderProviderList() {
  providerList.replaceChildren();
  const entries = localProviderEntries();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'model-provider-empty';
    empty.textContent = 'Aucun serveur de modèles local connecté.';
    providerList.append(empty);
    return;
  }

  for (const provider of entries) {
    const card = document.createElement('article');
    card.className = 'model-provider-row';

    const details = document.createElement('div');
    details.className = 'model-provider-details';
    const title = document.createElement('strong');
    title.textContent = provider.name || provider.type;
    const url = document.createElement('code');
    url.textContent = provider.baseUrl;
    const state = document.createElement('span');
    state.className = 'model-provider-state';
    state.textContent = provider.enabled === false ? 'Désactivé' : 'Prêt pour le test';
    details.append(title, url, state);

    const actions = document.createElement('div');
    actions.className = 'model-provider-actions';

    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'model-enabled-toggle';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = provider.enabled !== false;
    enabled.addEventListener('change', () => {
      modelProviders.updateProvider(provider.id, { enabled: enabled.checked });
      state.dataset.status = enabled.checked ? '' : 'muted';
      state.textContent = enabled.checked ? 'Prêt pour le test' : 'Désactivé';
    });
    enabledLabel.append(enabled, document.createTextNode(' Activé'));

    const testButton = document.createElement('button');
    testButton.className = 'button compact';
    testButton.type = 'button';
    testButton.textContent = 'Tester';
    testButton.addEventListener('click', async () => {
      testButton.disabled = true;
      await testLocalProvider(provider, state);
      testButton.disabled = false;
    });

    const removeButton = document.createElement('button');
    removeButton.className = 'button compact danger';
    removeButton.type = 'button';
    removeButton.textContent = 'Supprimer';
    removeButton.addEventListener('click', () => {
      if (!window.confirm(`Supprimer ${provider.name || 'ce serveur local'} ?`)) return;
      modelProviders.removeProvider(provider.id);
      renderProviderList();
      setModelStatus('', 'Serveur supprimé.');
    });

    actions.append(enabledLabel, testButton, removeButton);
    card.append(details, actions);
    providerList.append(card);
  }
}

function applyProviderTypeDefaults() {
  const unsloth = providerType.value === 'unsloth-studio';
  providerName.value = unsloth ? 'Unsloth Studio' : 'LM Studio';
  providerUrl.value = unsloth ? 'http://127.0.0.1:8888' : 'http://localhost:1234';
  providerKeyField.hidden = !unsloth;
}

providerType.addEventListener('change', applyProviderTypeDefaults);

endpointForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  addProviderButton.disabled = true;
  setModelStatus('working', 'Enregistrement du serveur et demande d’accès au réseau local…');
  try {
    const type = providerType.value;
    const args = {
      name: providerName.value.trim(),
      baseUrl: providerUrl.value.trim(),
      tags: ['local', 'public-test-bench'],
    };
    const provider = type === 'unsloth-studio'
      ? createUnslothStudioProvider(args)
      : createLmStudioProvider(args);
    modelProviders.addProvider(provider);
    if (type === 'unsloth-studio') saveUnslothStudioApiKey(provider, providerKey.value);
    renderProviderList();

    const row = [...providerList.querySelectorAll('.model-provider-row')].at(-1);
    const state = row?.querySelector('.model-provider-state') || modelStatus;
    const connected = await testLocalProvider(provider, state);
    setModelStatus(
      connected ? 'ready' : 'attention',
      connected
        ? 'Les modèles locaux sont prêts. Ouvrez une galerie et choisissez-en un dans le sélecteur de modèles.'
        : 'Le serveur a été enregistré. Suivez les indications ci-dessus, puis cliquez à nouveau sur Tester.',
    );
  } catch (error) {
    setModelStatus('error', error?.message || 'Impossible d’ajouter le serveur.');
  } finally {
    addProviderButton.disabled = false;
  }
});

renderProviderList();
// Provider settings can hydrate from the connected data root just after module
// startup. Re-render once so disk-backed endpoints appear without a refresh.
setTimeout(renderProviderList, 250);
