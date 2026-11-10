# Validation Mastra — 10 novembre 2026

Commit principal : `0dd2129`.

- 104 tests serveur : succès.
- 357 tests JavaScript existants et nouveaux : succès.
- 6 tests du moteur Mastra réel avec fournisseur simulé : succès.
- Deux agents en parallèle, outils Docker réels : succès.
- Parcours normal : 4 appels simulés, sortie HTML, Chromium sans erreur, ZIP source.
- Parcours de réparation : erreur TypeScript constatée, correction, nouvelle construction et Chromium ; 6 appels simulés.
- Aucun appel OpenRouter payant utilisé pour cette intégration.

Les images `llm-bench-mastra:latest`, `llm-bench-agent-sandbox:latest` et une version testée `llm-test-bench-local:mastra` ont été construites. La dernière reconstruction du serveur a échoué à l’export avec `input/output error` dans le stockage Docker. Une copie du skill a également renvoyé `No space left on device`, puis réussi après retrait des dépendances temporaires de travail. Docker Desktop ne répond plus normalement ; le port 8085 est indisponible. Aucun volume utilisateur n’a été supprimé ou réinitialisé.

L’activation reste à terminer après rétablissement de Docker. Contrôler d’abord `./benchctl status --json` et ne couper aucun appel actif, puis reconstruire les images avec `docker compose build`, activer `docker compose up -d --wait`, vérifier `/healthz`, et relire les projets conservés. Les ressources de test séparées sont nommées `llm-bench-mastra-smoke-*` ; elles ne contiennent que de fausses clés et des données simulées.
