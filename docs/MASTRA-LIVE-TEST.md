# Vrai test OpenRouter / Mastra — 11 novembre 2026

L’utilisateur a autorisé un petit lot réel Fable + Opus sur son compte. Plafond annoncé et appliqué : **0,50 $US au total**, soit 0,25 $US par agent. Aucun appel payant supplémentaire de correction n’a été lancé.

Même consigne pour les deux modèles : petite page française « Compteur de test », valeur 0, boutons « +1 » et « Réinitialiser », responsive et sans réseau. Réglages de ce test uniquement : effort `low`, 2 048 tokens maximum par appel, 4 appels maximum par modèle. Les préférences habituelles de comparaison ne sont pas modifiées.

| Modèle réel | État | Durée de l’agent | Appels API | Coût confirmé OpenRouter |
|---|---|---:|---:|---:|
| `anthropic/claude-fable-5.2` | Réussi | 20,35 s | 4 | 0,120720 $US |
| `anthropic/claude-opus-5.5` | Réussi | 15,44 s | 4 | 0,051888 $US |
| Total | 2 réussites | Appels simultanés | 8 | **0,172608 $US** |

Identifiants durables :

- Fable : `61061d9d9256448f93b415d34a8e0a0d`.
- Opus : `2a9da3dc50624d1a970437790e2dc5d6`.
- Groupe de comparaison : `test-mastra-reel-20261111` ; prompt `test-compteur-mastra`.

Les premières connexions fournisseur sont séparées de 0,451 seconde et leurs intervalles se chevauchent : les agents ont réellement tourné en parallèle. Tous les appels ont une facture confirmée ; aucun coût manquant. Les deux agents ont écrit des sources, construit le projet avec Vite et effectué un test de démarrage Chromium. Les sorties compilées font respectivement 2 862 et 2 118 caractères. Les sources chiffrées et les événements restent dans SQLite.

Vérification indépendante après génération, sans appel au modèle : ouverture des deux HTML exacts dans de nouveaux bacs à sable Docker sans réseau ni montage hôte. Sur chaque page : valeur initiale 0, trois clics « +1 » donnent 3, « Réinitialiser » redonne 0. Sur écran 390 × 844 : incrément et remise à zéro réussissent, aucun débordement horizontal. Également vérifié en 1 440 × 900. Aucune erreur JavaScript ni requête réseau externe. Captures ordinateur/mobile inspectées ; les deux compteurs sont visibles et utilisables.

Le premier lancement a révélé un refus de contrôle Mastra (HTTP 401), avant tout appel OpenRouter et sans frais. Cause confirmée : le contrôleur tournait avec UID 0 et toutes ses capacités supprimées ; il ne pouvait donc pas lire le jeton mode 0600 appartenant à l’UID 10001. Compose utilise désormais l’UID 10001 et ajoute seulement le groupe du socket Docker. Une requête de contrôle authentifiée volontairement invalide renvoie maintenant HTTP 400 comme prévu, sans démarrer de génération.

Pour lancer ce vrai lot dans le worker de l’application sans manipuler de session navigateur, la CLI dispose de `agent-start --plan-file … --execute --json`. Son socket Unix privé est accessible uniquement au compte serveur dans le conteneur ; aucun endpoint HTTP d’administration n’est ajouté. Quatre tests couvrent le budget total, l’idempotence des identifiants, le socket privé et le maintien de l’authentification HTTP. **108 tests serveur passent** après cet ajout.

Ce résultat valide ce petit lot réel et ses interactions. Il ne promet pas qu’un prompt arbitraire, un projet beaucoup plus complexe ou un fournisseur toujours disponible réussira à chaque fois.
