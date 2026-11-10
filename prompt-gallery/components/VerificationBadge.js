import { html } from 'htm/preact';

const META = {
  passed: { label: 'Vérifié', icon: 'fa-circle-check', cls: 'passed' },
  warned: { label: 'À vérifier', icon: 'fa-circle-question', cls: 'warned' },
  failed: { label: 'Échec de la vérification', icon: 'fa-circle-xmark', cls: 'failed' },
  audit_error: { label: 'Erreur d’audit', icon: 'fa-triangle-exclamation', cls: 'failed' },
  no_progress: { label: 'Aucun progrès', icon: 'fa-equals', cls: 'warned' },
  budget: { label: 'Budget de correction atteint', icon: 'fa-gauge-high', cls: 'failed' },
  stopped: { label: 'Enregistré — vérification interrompue', icon: 'fa-hand', cls: 'warned' },
};

export function verificationMeta(verification) {
  if (!verification) return null;
  return META[verification.status] || { label: verification.status || 'Vérification', icon: 'fa-shield-halved', cls: 'warned' };
}

export function VerificationBadge({ verification }) {
  const meta = verificationMeta(verification);
  if (!meta) return null;
  return html`<span class=${`verification-badge ${meta.cls}`} title=${`Motif d’arrêt : ${verification.stopReason || verification.status || 'unknown'}`}>
    <i class=${`fa-solid ${meta.icon}`}></i> ${meta.label}
  </span>`;
}

function fmtUsage(value) { return value == null ? 'unknown' : Number(value).toLocaleString(); }

export function VerificationDetails({ verification, parentId, onOpenParent }) {
  if (!verification) return null;
  const checklist = verification.checklist?.checks || [];
  const auditRows = new Map((verification.audit?.checks || []).map(row => [row.id, row]));
  const sandbox = verification.sandbox || {};
  const telemetry = verification.telemetry || {};
  return html`
    <details class="verification-details">
      <summary><${VerificationBadge} verification=${verification} /> <span>${verification.verdict?.passedMust || 0}/${verification.verdict?.totalMust || checklist.filter(c => c.priority === 'must').length} exigences obligatoires satisfaites</span></summary>
      <div class="verification-details-body">
        <div class="verification-summary-line">
          <span>Version : ${verification.candidate || 'original'}${verification.round ? ` · cycle ${verification.round}` : ''}</span>
          <span>Arrêt : ${verification.stopReason || '—'}</span>
          <span>Progression : ${verification.verdict?.completionRatio == null ? '—' : `${Math.round(verification.verdict.completionRatio * 100)}%`}</span>
        </div>
        ${parentId && html`<div class="verification-parent">
          <i class="fa-solid fa-code-branch"></i> Parent:
          ${onOpenParent
            ? html`<button class="verification-parent-link" onClick=${() => onOpenParent(parentId)}>${parentId}</button>`
            : html`<span>${parentId}</span>`}
        </div>`}
        <div class=${`verification-sandbox ${sandbox.executed === false ? 'warned' : sandbox.timedOut || sandbox.errorCount ? 'failed' : 'passed'}`}>
          <strong>Bac à sable :</strong>
          ${sandbox.executed === false ? 'non exécuté' : sandbox.timedOut ? 'délai dépassé' : `${sandbox.errorCount || 0} erreurs, ${sandbox.warningCount || 0} avertissements`}
          ${sandbox.duration ? ` · ${sandbox.duration}ms` : ''}
        </div>
        <div class="verification-checks">
          ${checklist.map(check => {
            const row = auditRows.get(check.id) || { status: 'unknown', evidence: '' };
            return html`<div class=${`verification-check ${row.status}`} key=${check.id}>
              <i class=${`fa-solid ${row.status === 'pass' ? 'fa-check' : row.status === 'fail' ? 'fa-xmark' : 'fa-question'}`}></i>
              <div><strong>${check.requirement}</strong><small>${check.id} · ${check.source} · ${check.evidenceKind}</small>${row.evidence ? html`<p>${row.evidence}</p>` : null}</div>
            </div>`;
          })}
        </div>
        ${(verification.audit?.repairTasks || []).length > 0 && html`
          <div class="verification-tasks"><strong>Corrections à effectuer</strong><ul>${verification.audit.repairTasks.map(task => html`<li>${task}</li>`)}</ul></div>
        `}
        ${verification.audit?.notes && html`<p class="verification-notes">${verification.audit.notes}</p>`}
        <div class="verification-usage">
          <span>${(telemetry.calls || []).length} appels de rôle</span>
          <span>${fmtUsage(telemetry.promptTokens)} tokens du prompt</span>
          <span>${fmtUsage(telemetry.responseTokens)} tokens de réponse</span>
        </div>
      </div>
    </details>
  `;
}
