# Échecs et reprises

| Observation | Décision |
|---|---|
| `length`, zéro HTML, nombreux tokens de raisonnement | Le budget de sortie a été consommé par le raisonnement. Utiliser les capacités API ; un effort est distinct d’un budget fixe de raisonnement. La politique apprise réduit l’effort automatique au prochain départ. |
| Même échec au minimum d’effort | État `reasoning-exhausted`, arrêt des répétitions. Le serveur bloque également une nouvelle exécution automatique identique après cet échec à effort faible. Pour continuer, préparer un prompt plus réalisable ou une construction par étapes dans un nouveau plan, sous l’autorisation existante. Ne pas simplement effacer le blocage et refaire le même appel. |
| HTML partiel | Checkpoint conservé, reprise avec ce document et une demande de complétion ; trois appels maximum par élément, budget global inchangé. |
| `cost-unknown` ou tentative `pending` après interruption | Ne pas supposer une facture nulle. `reconcile JOB` consulte le coût du fournisseur avec l’identifiant de génération enregistré. Si le coût reste indisponible, garder la réservation et l’arrêt. |
| 400 / 401 / 402 / 403 / 404 / 409 / 422 | Corriger le paramètre, la clé, le crédit ou le blocage identifié. Aucun essai automatique identique. Ne pas contourner un filtrage de contenu. |
| 429 / 5xx transitoire | Reprise seulement si le coût précédent est connu et le budget le permet ; respecter Retry-After, sans attendre plus de 120 s dans le worker. |
| Pas de code pendant 180 s dans la CLI | Fermeture au prochain fragment reçu ; un fournisseur silencieux reste soumis au timeout réseau. La facture peut manquer : rapprocher avant toute reprise. Un effort élevé peut réellement être lent. |
| `budget-blocked` | Le solde du plan ne couvre pas la réservation prudente d’un nouvel appel. Ne pas augmenter le budget silencieusement. |
| Un modèle échoue | Les autres continuent. Reprendre seulement l’élément en échec ou préparer une réparation. |
| `saved` | Document HTML complet et conservé. Le serveur n’exécute pas le code généré : rendu et comportement encore à vérifier dans le bac à sable. |

La réservation utilise une borne prudente d’entrée en octets UTF-8, la sortie maximale et les tarifs annoncés, avec `provider.max_price` côté OpenRouter. Elle protège ce lot CLI uniquement. Les coûts réels sont ceux de `usage.cost` ou `generation.total_cost`. La limite d’appels s’applique aussi aux reprises ; un nouveau plan constitue une nouvelle enveloppe payante.

Documentation officielle à consulter si les capacités changent :

- https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
- https://openrouter.ai/docs/guides/routing/provider-selection
- https://openrouter.ai/docs/api/api-reference/generations/get-generation

Ne pas confondre tokens de raisonnement et signaux de progression. Le raisonnement interne n’est pas enregistré. Les modèles n’ont pas automatiquement un terminal, des fichiers ou Internet : ce runner demande un document HTML/CSS/JavaScript dans un appel texte, sans outils externes.
