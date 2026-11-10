// Reuse the saved document and its original brief; never regenerate it silently.
export function prepareGenerationResume(generation, prompts = []) {
  if (!generation?.response?.trim()) throw new Error('Aucun code enregistré à reprendre. Préparez une nouvelle tentative pour ce modèle.');
  const metadata = generation.metadata || {};
  if (!metadata.providerId || !metadata.modelId) throw new Error('Fournisseur ou modèle absent de cette ancienne génération. Utilisez Améliorer pour choisir un modèle.');
  if (!generation.prompt?.trim()) throw new Error('Le prompt d’origine est introuvable.');
  const original = prompts.find(p => p.prompt === generation.prompt);
  return {
    id:generation.id, variantKey:generation.variantKey, html:generation.response,
    prompt:{id:original?.id || generation.folderId || generation.id, title:original?.title || generation.folderId || 'Résultat enregistré', prompt:generation.prompt, tags:original?.tags || []},
    model:{backend:'model',providerId:metadata.providerId,modelId:metadata.modelId,label:metadata.model || metadata.modelId},
  };
}
