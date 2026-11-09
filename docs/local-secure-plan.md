# Plan d'implémentation locale

Objectif : satisfaire la demande dans docs/local-secure-design.md, puis lancer Docker et publier les changements dans le fork.

1. [x] Créer le fork, garder upstream, travailler sur feat/secure-local-fr.
2. [x] Serveur : écrire et constater l'échec des tests de sécurité ; implémenter les routes d'authentification, le coffre, le proxy fixe et l'API de fichiers ; vérifier les tests.
3. [x] Client : tester le helper de session/CSRF, déplacer la gestion OpenRouter vers le coffre serveur sans persister le secret côté client, ajouter les formulaires de compte français ; vérifier les parcours.
4. [x] Français : traduire les contrôles des écrans principaux sans modifier prompts ni code ; vérifier syntaxe et comportement.
5. [x] Docker : image non privilégiée, volumes données/secrets, publication loopback, healthcheck ; construire et lancer.
6. [x] Revue : examiner sécurité et intégration, corriger les problèmes concrets ; vérifier connexion, clé fictive, session, stockage et redémarrage sur instance jetable.
7. [x] Livrer : documentation française, commit et push dans le fork, instance finale disponible sans compte de test, rapport concis des limites.

Vérification : 18 tests serveur et 25 tests JavaScript réussis, 54 fichiers JS analysés. Revue indépendante : deux défauts P2 corrigés et revérifiés. Image Docker saine. Recréation du conteneur de test avec volumes : compte, session, clé fictive et projet conservés.
