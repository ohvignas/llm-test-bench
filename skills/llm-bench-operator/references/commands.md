# Commandes

Préfixer par `python3 <skill>/scripts/bench.py` ou lancer `./benchctl` dans le dépôt. `--json` existe pour toutes les opérations structurées. Python 3 sur l’hôte et Docker Compose avec le service `bench` démarré sont requis. Une installation Python native peut utiliser `python -m server.control` avec ses DATA_DIR et SECRETS_DIR habituels.

| Commande | Effet |
|---|---|
| `status`, `doctor`, `history --limit 10` | Activité de tous les appels suivis, diagnostic et historique navigateur |
| `journal FICHIER` | Diagnostic hors ligne d’un export JSON, même si Docker est arrêté |
| `cancel ID_APPEL` | Demande l’arrêt de cet appel exact ; au prochain fragment, coût déjà consommé possible |
| `models --query claude`, `models --id ID` | Catalogue public actualisé : capacités, tarifs par token, politique locale |
| `prompts --query jeu`, `prompts --id ID` | Prompts fournis et personnalisés, titres français et consigne complète |
| `settings --model ID` | Politique locale et adaptation apprise |
| `settings --model ID --effort low --max-output 16384` | Personnalisation persistante, vérifiée contre l’API ; ne lance rien |
| `settings --model ID --reset` | Efface la personnalisation ; conserve les échecs historiques observés |
| `plan …` | Prépare un lot durable ; ne génère rien |
| `run JOB --execute` | Démarre en arrière-plan ; `--foreground` attend au premier plan |
| `jobs`, `show JOB` | Lots et détails, appels, timestamps, réglages, coûts et résultats |
| `logs JOB --follow --seconds 30` | Événements bornés à 30 s ; répéter pendant le contrôle autorisé |
| `pause JOB` | Finit les appels en cours, puis attend avant les suivants |
| `resume JOB --execute` | Lève une pause existante ou reprend les éléments éligibles sans refaire les réussites |
| `stop JOB` | Arrête ce lot ; les sorties reçues restent sur disque |
| `reconcile JOB` | Consulte GET /generation pour les coûts manquants, sans nouvelle génération |
| `result JOB --item ID` | Écrit le HTML enregistré sur stdout ; rediriger vers un fichier pour inspection |
| `repair …` | Nouveau plan de correction basé sur un résultat de la galerie |
| `self-test` | Tests serveur isolés, sans génération payante |

Exemple à adapter aux modèles et prompts effectivement trouvés :

```sh
./benchctl plan --model MODELE_A --model MODELE_B --prompt PROMPT_A --prompt PROMPT_B \
  --budget-usd 1 --parallel 2 --attempts 3 --json
./benchctl show JOB --json
./benchctl run JOB --execute --json
./benchctl logs JOB --follow --seconds 30
./benchctl show JOB --json
```

Plusieurs `--prompt` permettent de mélanger les catégories. `--prompt-file /chemin/consigne.md` fournit une consigne personnalisée UTF-8, jusqu’à 1 Mio, via stdin. Son contenu part au fournisseur lors de `run`.

Le plan adapte la sortie au budget si `--max-output` est omis. `--effort` impose un choix accepté par l’API pour le premier appel ; éviter d’imposer `high` à un modèle ayant déjà épuisé sa sortie sans code. Le plan sans cet override exploite la politique apprise. Les reprises réduisent ensuite l’effort.

Correction d’un résultat :

```sh
./benchctl repair --generation DOSSIER/VARIANTE --instructions "Le bouton Démarrer déclenche ReferenceError: player is undefined ; corriger en gardant le jeu." \
  --budget-usd 0.5 --attempts 2 --json
```

Le modèle d’origine est repris sauf si `--model` est fourni. La sortie originale est conservée. Le nouveau plan doit être exécuté avec `run JOB --execute`.

Les manifestations et checkpoints sont dans `/data/cli-jobs/JOB/`, hors de l’API fichiers. Les résultats sont copiés dans `/data/files/prompt-gallery/` avec des métadonnées de lot et de coûts. Ils sont visibles dans la galerie après actualisation. `job.items[].result` contient `DOSSIER/VARIANTE`. La clé reste chiffrée dans le stockage serveur ; aucune commande ne l’affiche.
