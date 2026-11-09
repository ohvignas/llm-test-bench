# LLM Test Bench — version locale, connexion et interface française

Fork de [Techdread/llm-test-bench](https://github.com/Techdread/llm-test-bench). Les outils d'origine sont conservés. La galerie de sites, ses réglages et ses dialogues sont traduits en français. Les prompts d'exemple, l'aide de l'amont et certaines autres applications restent en anglais.

## Démarrer

Installer et démarrer Docker Desktop, puis dans ce dépôt :

```sh
docker compose up -d --build
```

Ouvrir **http://127.0.0.1:8085**. Au premier démarrage, choisir un identifiant et un mot de passe d'au moins 12 caractères. Après création de ce compte unique, la création d'autres comptes est fermée. Se connecter, ouvrir **Mon compte et ma clé API** et enregistrer sa clé OpenRouter.

Pour comparer deux modèles : ouvrir **Lots**, choisir un même prompt, ajouter les deux modèles, sélectionner **Tous en même temps**, puis lancer. Les résultats peuvent être sauvegardés et alignés dans **Comparer**. Le prix des appels reste celui d'OpenRouter et des modèles choisis.

## Ce qui est conservé

La version d'origine ne possédait pas de base serveur : clés et projets reposaient sur le navigateur ou un dossier choisi. Cette version utilise :

| Donnée | Emplacement |
|---|---|
| Identifiant, empreinte scrypt du mot de passe, sessions | SQLite, volume `bench-data` |
| Clé OpenRouter chiffrée et authentifiée avec Fernet | Même base SQLite |
| Clé de chiffrement générée au premier démarrage | Volume distinct `bench-secrets` |
| Projets, réglages et statistiques | Sous-dossier `files` du volume `bench-data` |

Un redémarrage ou une reconstruction de l'image conserve ces volumes. Le navigateur ne reçoit pas la clé enregistrée ; les requêtes sont relayées par le serveur uniquement vers l'API OpenRouter officielle. L'interface reçoit seulement l'information « clé configurée ».

Arrêter sans supprimer les données : `docker compose stop`. Redémarrer : `docker compose up -d`. Pour sauvegarder ou déplacer cette installation, conserver **les deux volumes ensemble**. La suppression d'un volume supprime ses données ; la base seule ne permet pas de récupérer la clé sans le volume de chiffrement. Aucun secret n'est versionné dans Git.

## Protections et limites

- Publication du port limitée à `127.0.0.1` ; conteneur exécuté sans root et système de fichiers en lecture seule hors données/secrets/tmp.
- Sessions opaques en base, cookie HttpOnly et SameSite Strict ; contrôles Origin et CSRF sur les écritures, limitation des tentatives de connexion.
- Clé OpenRouter chiffrée au repos, sans route de lecture du secret ni stockage de cette clé dans localStorage.
- API de fichiers authentifiée, chemins contraints au dossier de données, liens symboliques refusés, téléchargements de code isolés.
- Aperçus HTML sandboxés et script de statistiques Cloudflare retiré à la distribution locale.

Notebook Lab et Algorithm Visualizer sont disponibles. Leur JavaScript s'exécute encore dans le contexte de l'application : il ne peut pas lire la clé conservée au serveur, mais peut agir avec les droits de la session ouverte. Exécuter dans ces deux outils uniquement du code de confiance. Une connexion ne remplace pas une isolation complète de tous les moteurs de la suite. Les aperçus HTML de Prompt Gallery conservent leur contexte séparé.

Le chiffrement protège une copie isolée de la base. Une personne contrôlant Docker ou ayant accès à la fois à la base et au volume de secrets peut déchiffrer la clé. Cette configuration est destinée à un ordinateur local ; un hébergement public demanderait notamment HTTPS et une configuration de déploiement revue.

Les fournisseurs autres qu'OpenRouter conservent les mécanismes de configuration de l'amont ; le coffre ajouté concerne la clé OpenRouter. Aucun appel de génération payant n'est réalisé par les tests. Le pont privé des agents CLI de l'auteur n'est pas inclus dans ce dépôt public.

## Vérification

```sh
python -m unittest discover -s server/tests -v
node --test shared/tests/secure-session.test.mjs shared/tests/openrouter-vault.test.mjs shared/tests/providers-openai-compatible.test.mjs shared/tests/gen-params.test.mjs shared/tests/distribution.test.mjs
docker compose ps
```

La suite serveur vérifie comptes, sessions, CSRF, origine, chiffrement, persistance, proxy fixe, fichiers et statistiques. Les tests navigateur vérifient que la clé n'est jamais renvoyée et qu'un ancien onglet récupère son jeton après une reconnexion.

Pour les fonctions amont : [README d'origine](README.md).
