# LLM Test Bench — compare tes modèles IA en local

**Français** · [English](README.en.md) · [Sauvegarde et récupération](docs/OPERATIONS.md)

Donne le même prompt à plusieurs modèles, lance-les en parallèle, compare leurs sites côte à côte et conserve les résultats avec les mesures disponibles de temps, de tokens et de coût. **Chacun utilise sa propre clé OpenRouter.**

Ce fork de [Techdread/llm-test-bench](https://github.com/Techdread/llm-test-bench) ajoute une connexion, un coffre chiffré côté serveur, des données persistantes dans Docker et une interface principale en français. Le code est distribué sous [licence MIT](LICENSE).

Tout le monde peut installer sa propre copie avec ses identifiants et sa clé. **Chaque installation possède un compte administrateur unique** : cette version ne sépare pas les données de plusieurs comptes sur un serveur partagé.

## Ce que tu peux faire

- Générer une page HTML/CSS/JavaScript avec le modèle de ton choix.
- Lancer le même prompt sur plusieurs modèles simultanément et comparer leurs rendus.
- Sauvegarder les variantes, noter les résultats et retrouver les exécutions et leurs métriques disponibles.
- Utiliser les autres outils amont : SVG, p5.js, jeux, notebooks, visualisations et outils de code.
- Retrouver tes projets et ta clé après un redémarrage, sans la ressaisir.

## Prérequis

- **Docker en marche** : [Docker Desktop](https://docs.docker.com/desktop/) sur macOS/Windows, ou [Docker Engine](https://docs.docker.com/engine/install/) avec le [plugin Compose](https://docs.docker.com/compose/install/) sur Linux. Sous Windows, utiliser les conteneurs Linux.
- **Git**, disponible sur [git-scm.com](https://git-scm.com/downloads), ou le ZIP du dépôt via **Code → Download ZIP** sur GitHub.
- Un navigateur récent ; Chrome ou Edge sont recommandés pour la sélection de dossiers et la capture vidéo.
- Une connexion Internet pour la première construction et les appels aux modèles distants. Aucun GPU local n'est nécessaire pour appeler OpenRouter.

Docker installe Python, les dépendances et SQLite : aucun Python, Node.js ou serveur de base de données n'est nécessaire sur ton ordinateur. Le code du projet est sous MIT ; Docker Desktop possède ses propres conditions de licence. Les appels aux modèles peuvent être payants selon les tarifs OpenRouter et le modèle choisi.

## Installation

Dans Terminal sur macOS/Linux ou PowerShell sur Windows :

```sh
git clone https://github.com/ohvignas/llm-test-bench.git
cd llm-test-bench
docker compose up -d --build --wait
```

Ouvrir **[http://127.0.0.1:8085](http://127.0.0.1:8085)**. La première construction peut prendre quelques minutes. Avec le ZIP, entrer dans le dossier extrait avant d'exécuter la commande Compose.

### Premier démarrage

1. Choisir un identifiant et un mot de passe d'au moins **12 caractères**. Il n'y a pas de mot de passe par défaut. La création de comptes est fermée après ce premier compte.
2. Ouvrir **Mon compte et ma clé API** et enregistrer ta [clé OpenRouter](https://openrouter.ai/settings/keys).
3. Revenir à la galerie, choisir un modèle et saisir un prompt.

La clé est chiffrée côté serveur et n'est jamais réaffichée par une route de lecture. Elle reste disponible après un arrêt ou une reconstruction du conteneur. Aucun identifiant ni secret de l'auteur n'est inclus dans l'image.

### Comparer deux modèles

1. Ouvrir **Lots** et sélectionner le prompt à tester.
2. Sélectionner chaque modèle et l'ajouter à la liste des modèles à exécuter.
3. Choisir **Tous en même temps**, puis lancer.
4. Retrouver les résultats sauvegardés dans **Exécutions**, **Galerie** et **Comparer**.

Les métriques dépendent des informations transmises par le modèle ou le fournisseur. Une donnée absente ne doit pas être interprétée comme un coût ou une durée nuls.

## Changer le port si nécessaire

Le lancement par défaut ne nécessite aucun fichier `.env`. Si le port 8085 est occupé, copier `.env.example` vers `.env` :

- macOS/Linux : `cp .env.example .env`
- Windows PowerShell : `Copy-Item .env.example .env`

Modifier ensuite cette ligne dans `.env` :

```dotenv
BENCH_PORT=8090
```

Puis relancer :

```sh
docker compose up -d --build --wait
```

L'adresse devient `http://127.0.0.1:8090`. Le port publié et l'origine acceptée par l'application sont modifiés ensemble. Garder le même dossier de projet pour réutiliser ses volumes. **Ne mettre aucun mot de passe ni clé API dans `.env`.**

## Utilisation quotidienne

Toutes les commandes se lancent depuis le dossier contenant `compose.yaml`.

| Action | Commande |
|---|---|
| Relancer | `docker compose up -d --wait` |
| Arrêter sans effacer les données | `docker compose stop` |
| Vérifier l'état et le port | `docker compose ps` |
| Voir les logs récents du serveur | `docker compose logs --tail=100 bench` |
| Mettre à jour un clone Git | `git pull --ff-only`, puis `docker compose up -d --build --wait` |
| Récupérer un mot de passe oublié | `docker compose exec bench python -m server.manage reset-password` |
| Exécuter les tests serveur sans Python installé | `docker compose exec -T bench python -m unittest discover -s server/tests -v` |

Les logs ci-dessus servent au diagnostic du serveur local. Les résultats des modèles et les statistiques d'exécution se consultent dans l'application.

Pour une installation obtenue en ZIP, sauvegarder les volumes avant une mise à jour et suivre le [guide de migration](docs/OPERATIONS.md) : un dossier renommé peut désigner un autre projet Compose et donc d'autres volumes.

## Données, sauvegarde et migration

| Volume Docker | Contenu |
|---|---|
| `bench-data` | SQLite : compte, empreinte du mot de passe, sessions et clé API chiffrée ; fichiers des projets, réglages et métriques |
| `bench-secrets` | Clé de chiffrement du coffre, générée au premier démarrage |

Les noms complets des volumes sont préfixés par le nom du projet Compose. Ils ne dépendent pas d'un chemin propre à l'ordinateur de l'auteur.

**Sauvegarder les deux volumes ensemble.** Le [guide d'exploitation](docs/OPERATIONS.md) donne les commandes pour sauvegarder, restaurer sur une nouvelle machine et réinitialiser un mot de passe sans perdre les projets ou la clé API. Les mises à jour et redémarrages conservent les volumes. Les supprimer efface leurs données.

## Dépannage

| Problème | Vérification |
|---|---|
| Docker ne répond pas | Démarrer Docker Desktop ; sous Linux, vérifier l'accès au daemon. |
| La commande `docker compose` manque | Installer le plugin Compose ou mettre Docker Desktop à jour. |
| Le port est déjà occupé | Définir un autre `BENCH_PORT` dans `.env`, puis relancer `up`. |
| La page ne s'ouvre pas | Vérifier `docker compose ps` et les logs ; utiliser `127.0.0.1` et le port configuré. |
| Clé refusée ou génération en échec | Vérifier la clé, le crédit, la disponibilité du modèle et les limites de tokens sur OpenRouter. |
| Les données semblent avoir disparu | Vérifier le dossier/nom du projet Compose et la présence des deux volumes ; ne pas les supprimer. |
| Identifiants oubliés | Lancer `reset-password` ; la commande affiche aussi l'identifiant du compte. |

Pour signaler un problème : [ouvrir une issue dans ce fork](https://github.com/ohvignas/llm-test-bench/issues), avec le système utilisé, les étapes et des logs relus pour en retirer toute donnée sensible. Ne pas joindre de clé, de mot de passe ni de sauvegarde.

## Périmètre et sécurité

- Le port est publié uniquement sur `127.0.0.1` ; l'application est destinée à l'ordinateur local.
- Connexion avec cookie HttpOnly/SameSite, contrôles Origin/CSRF sur les écritures, limitation des tentatives et conteneur exécuté sans root.
- Clé OpenRouter chiffrée au repos, injectée par le serveur uniquement dans son relais vers l'API OpenRouter officielle.
- Statistiques Cloudflare retirées des pages distribuées localement ; aperçus HTML isolés et routes de fichiers protégées.

Une personne contrôlant Docker ou les deux volumes peut déchiffrer la clé. Notebook Lab et Algorithm Visualizer exécutent encore du JavaScript avec les privilèges de la page : y utiliser du code de confiance. Les aperçus HTML de Prompt Gallery conservent leur isolation. Les autres fournisseurs gardent les mécanismes de configuration de l'amont ; le coffre ajouté concerne OpenRouter.

Cette configuration n'est pas un service public avec comptes et données séparés. Le pont privé des agents CLI de l'auteur n'est pas inclus. La galerie de sites et les réglages principaux sont en français ; certaines autres applications, les aides et les prompts d'exemple restent en anglais. Consulter [SECURITY.md](SECURITY.md) pour les détails.

## Contribuer et crédits

[Contribuer](CONTRIBUTING.md) · [Documentation anglaise](README.en.md) · [Licence MIT](LICENSE) · [Licences tierces](THIRD_PARTY_NOTICES.md) · [Documentation historique amont](README.upstream.md)

Projet original : **Techdread / Peter Edwards**. Les mentions originales et les licences des bibliothèques sont conservées. Ce fork ajoute l'installation Docker, l'authentification locale, le coffre serveur et la traduction française de l'interface principale.
