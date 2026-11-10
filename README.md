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

1. Ouvrir **Lots** et sélectionner le prompt à tester. La barre **Rechercher un prompt** filtre les titres français, les noms d’origine, les descriptions et les étiquettes. Sans résultat dans la série choisie, des raccourcis proposent les autres séries correspondantes. Les cases commencent décochées. Vous pouvez sélectionner un prompt dans **Base**, puis un autre dans **Avancés** ou une autre catégorie : les choix s’additionnent dans le même lot. La catégorie et la recherche filtrent uniquement la liste, sans modifier les choix. **Tout cocher ici** et **Tout décocher ici** agissent uniquement sur les résultats affichés. Le récapitulatif **Sélection du lot** montre tous les prompts qui seront lancés, y compris ceux d’autres catégories ; retirez un prompt individuellement ou utilisez **Vider la sélection** pour tout désélectionner. Le bouton **Lancer** indique le nombre total de prompts sélectionnés.
2. Sélectionner chaque modèle et l'ajouter à la liste des modèles à exécuter.
3. Vérifier le nombre d’appels prévu, puis lancer. La protection des dépenses exécute les modèles l’un après l’autre ; la désactiver permet de choisir **Simultanément**.
4. Retrouver les résultats sauvegardés dans **Exécutions**, **Galerie** et **Comparer**.

Les métriques dépendent des informations transmises par le modèle ou le fournisseur. Une donnée absente ne doit pas être interprétée comme un coût ou une durée nuls.

Pendant le lot, chaque ligne indique la phase de son modèle, notamment le raisonnement avant l'arrivée du HTML. Sélectionner une ligne change l'aperçu et le flux de code affichés ; les autres modèles continuent selon le mode d’exécution choisi. Pour voir les rendus côte à côte, ouvrir **Comparer** après leur enregistrement et sélectionner deux à quatre générations.

Le **Journal de génération** s’ouvre par défaut pendant un lot. Il affiche les étapes horodatées par modèle, la connexion, les signaux de raisonnement, l’arrivée du HTML, les erreurs, les tentatives et les mesures finales communiquées par le fournisseur. Sélectionner une ligne filtre le journal ; **Tous les modèles** réunit les appels. **Aperçu et code** permet de revenir au rendu.

Le journal indique le temps écoulé depuis le dernier signal réseau. Après 60 secondes de silence, il signale une attente prolongée, sans conclure à une panne ni relancer automatiquement l’appel. Il ne reproduit ni les prompts complets, ni les réponses, ni le raisonnement interne, ni les en-têtes de connexion. Les messages d’erreur passent par un masquage des formats usuels de clés et jetons. Les 400 dernières entrées restent disponibles après le lot dans cette fenêtre ; **Exporter le journal** télécharge la sélection en JSON. Ce journal local ne reconstitue pas rétroactivement les appels lancés depuis une ancienne interface.

Dans **Options d’exécution → Adaptation aux capacités API**, les réglages OpenRouter sont calculés séparément pour chaque modèle à partir de `GET /models` : limites de contexte et de sortie, paramètres acceptés, efforts disponibles et raisonnement obligatoire. Le catalogue est actualisé à l’ouverture du lot, sur demande et avant le lancement ; les appels utilisent un cache de cinq minutes. Les anciens caches sans capacités sont invalidés. [Champs de raisonnement OpenRouter](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#discovering-per-model-reasoning-options).

- **Effort maximal** (choix explicite) demande la sortie maximale et l’effort le plus élevé annoncés par chaque modèle. Cela augmente les plafonds possibles de durée et de dépense, sans garantir un meilleur résultat. Les tokens de raisonnement et le code partagent généralement le même budget : même ce profil peut terminer sans HTML.
- **Génération de code** (profil initial des lots) demande jusqu’à 32768 tokens, plafonnés à la limite API, avec un effort réduit lorsqu’il est configurable. C’est aussi le profil des générations simples et des opérations Améliorer hors lot.
- **Budget personnalisé** permet de choisir un total commun. Chaque modèle conserve sa propre limite API ; sa sortie et son effort peuvent être personnalisés individuellement dans la fiche. Les préférences de profil et personnalisations sont mémorisées dans ce navigateur, sans clé API.

La fiche de chaque modèle affiche les réglages effectifs et les paramètres envoyés pour une génération en un appel ; le plan affiche les plafonds réduits propres aux étapes. Les paramètres d’échantillonnage non acceptés sont retirés ; les autres restent aux valeurs du fournisseur lorsqu’aucune valeur n’est demandée. Un budget fixe de raisonnement est envoyé uniquement si l’API annonce sa prise en charge ; les profils Génération de code et Budget personnalisé le privilégient, sauf désactivation explicite du raisonnement. Sinon, ils utilisent un effort accepté. L’application ne devine plus les capacités à partir du nom ou du numéro de version d’un modèle. Un modèle sans sortie texte, sans contrôle de sortie, ou dont les capacités sont indisponibles, ne peut pas être lancé comme s’il était compatible. Pour un modèle sans plafond de sortie annoncé, utilisez un budget personnalisé.

Le routage exige la prise en charge des paramètres envoyés (`provider.require_parameters`). Les réglages, les ajustements et les diagnostics issus de l’usage réel sont consultables dans le journal. Un refus de paramètres conserve le message API avec masquage des clés et bloque les relances automatiques ; actualisez les capacités avant de relancer manuellement. Une limite de sortie épuisée recommande de réduire le raisonnement ou le périmètre, sans relancer l’appel. Les fournisseurs locaux gardent leurs réglages natifs : les capacités OpenRouter ne leur sont pas appliquées.

Le lot affiche le **coût réel communiqué par l’API** pour chaque appel, le cumul par prompt et modèle et le total confirmé. Il se met à jour à la réception de l’usage, généralement à la fin d’un appel. Les appels de génération, d’audit, de correction et les échecs facturés sont inclus. Aucun coût n’est estimé : une valeur absente reste « en attente » ou « non communiquée », jamais zéro. Les coûts sont inclus dans l’export du journal et dans les métadonnées des résultats sauvegardés. Les variantes d’un même prompt peuvent contenir les mêmes identifiants d’appels : dédupliquez-les avant de totaliser plusieurs variantes. Les anciens résultats et appels déjà lancés ne sont pas recalculés.

Un arrêt `content_filter` est affiché comme un **filtrage signalé par le fournisseur**, avec conservation des coûts communiqués, même sans HTML. Le motif précis n’est pas déduit lorsqu’il n’est pas fourni. Une réponse interrompue par ce filtre reste en échec même si du texte a déjà été reçu, et ne déclenche aucune relance automatique.

La **protection des dépenses** est activée à chaque ouverture du lot : un appel à la fois, arrêt du lot au premier échec, aucune tentative automatique. Cela évite de démarrer les autres modèles ou prompts après un échec. Les réglages antérieurs du profil maximal sont réinitialisés lors de cette mise à jour ; les générations sauvegardées sont conservées. Pour retrouver le parallélisme, désactivez explicitement cette protection. Les requêtes OpenRouter de Prompt Gallery ayant échoué ne sont jamais relancées automatiquement, même après une erreur réseau : leur facturation peut être inconnue. Les fournisseurs locaux peuvent conserver leurs tentatives lorsque la protection est désactivée. Examinez l’erreur et les mesures avant de relancer manuellement. Les tokens de raisonnement peuvent être facturés même si aucun site n’est produit ([documentation OpenRouter](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)).

Les relances OpenRouter identiques après un échec, une interruption ou un HTML incomplet sont bloquées dans ce navigateur. Après un `content_filter`, augmenter le budget ne débloque pas le même prompt et modèle. Seules des empreintes SHA-256 des requêtes sont conservées (100 entrées maximum), sans texte ni clé ; ce mécanisme local n’est pas un plafond financier global du compte OpenRouter. L’édition Docker conserve aussi une réservation dans SQLite avant chaque appel : les doublons en cours et les prompts/modèles déjà échoués sont refusés avant de contacter OpenRouter, depuis tous les navigateurs. Ce blocage serveur ignore les hausses de budget. Les entrées ne contiennent que des empreintes et un état. Le bouton de réinitialisation est protégé par connexion et CSRF ; il ne débloque pas les appels réellement en cours. Après un redémarrage, les réservations d’un ancien processus peuvent être effacées par ce même bouton. Le bouton **Autoriser les relances après échec** efface ces blocages pour une tentative volontaire qui pourra être facturée. Les appels restés en cours lors d’une actualisation sont aussi bloqués ; la protection ne reconstitue pas les anciens appels lancés avant cette mise à jour.

L’[assurance OpenRouter pour les réponses vides](https://openrouter.ai/docs/guides/features/zero-completion-insurance) est automatique mais ne couvre pas toute absence de HTML : notamment, des tokens de raisonnement peuvent être facturés avec un arrêt `length` ou `content_filter`. Il n’existe ici aucune garantie de remboursement ni de coût nul en cas d’annulation. Pour Claude Opus 5.5, les [budgets fixes de raisonnement ne sont pas transmis ; utilisez l’effort](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/model-migrations/claude-5-5).

### Construire GTA VI par étapes

Dans **Lots → Rapide**, **Construire les prompts GTA VI par étapes** est activé par défaut. Les trois variantes GTA VI ont un plan explicite : 4 étapes pour Base, 6 pour Avancés et 9 pour Simulations complexes. La première vise une version jouable limitée ; les suivantes enrichissent le document produit à l’étape précédente. Chaque étape correspond à un appel potentiellement facturé, pour chaque modèle sélectionné. Le récapitulatif et le bouton de lancement annoncent le nombre d’appels prévu, en excluant les prompts ignorés ; un arrêt peut réduire ce nombre. Le détail affiche les objectifs des étapes et leurs plafonds.

Sur OpenRouter, le plafond est de **12 288 tokens par étape**, première comprise, toujours réduit si votre réglage ou la limite API est plus bas. Les étapes utilisent le profil **Génération de code**, avec raisonnement réduit, même si un effort supérieur a été choisi pour les générations en un appel. Les autres fournisseurs conservent leurs réglages natifs : ces plafonds et ce profil ne leur sont pas appliqués. Chaque HTML complet obtenu est enregistré avant l’étape suivante. Au premier échec, la construction s’arrête : les versions précédentes restent dans la galerie et leurs coûts réels dans le journal. Cela ne garantit ni la réussite de chaque appel, ni l’achèvement de toutes les fonctionnalités. Décocher l’option conserve la génération à partir du prompt d’origine en un seul appel. Les prompts modifiés personnellement, les autres prompts et les modes Correction des erreurs/Vérifié gardent leur fonctionnement.

Claude Fable 5.2 et Opus 5.5 imposent un raisonnement adaptatif. **`low` est une indication, pas une réserve de tokens pour le HTML** : le modèle peut encore consommer le plafond sans réponse visible. La construction par étapes limite le travail demandé à chaque appel et sauvegarde les progrès ; elle ne contourne pas cette limite du fournisseur. [Fonctionnement et coût du raisonnement Anthropic](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost).

## Bibliothèque de prompts en français

La bibliothèque propose **165 prompts** : 92 de base, 40 avancés, 9 simulations complexes et **24 nouveaux tests « Sites web »**. Ouvrir **Prompts → Sites web** pour les parcourir ; dans **Lots**, choisir cette même série pour les comparer sur plusieurs modèles.

Les 140 fiches d’origine ont un titre, une description et un résumé des points de contrôle en français. Développer une fiche affiche la consigne originale exacte : son texte et ses notes d’évaluation restent conservés pour comparer les résultats historiques. Les noms de dossiers et les identifiants d’origine ne changent pas. Les descriptions personnelles peuvent être modifiées dans le formulaire d’édition.

Les 24 nouveaux prompts sont entièrement en français et couvrent boutiques, portfolios, réservations, tableaux de bord, formulaires, accessibilité, données CSV et outils interactifs. Ils demandent un document HTML autonome, des données fictives et aucun appel réseau. Ils comportent des interactions vérifiables et, lorsque pertinent, des jeux de données avec des résultats numériques attendus. Les points de contrôle sont des critères de vérification ; ils ne constituent pas une nouvelle suite de tests automatiques.

Ces briefs sont originaux. Leur couverture s’inspire des travaux [FrontendBench](https://arxiv.org/abs/2506.13832) et [Vision2Web](https://vision2web-bench.github.io/), sans reproduire les tâches de ces jeux de données ni constituer leur évaluation officielle. Les références figurent aussi dans `prompt-gallery/data/library-web.json`.

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

Cette configuration n'est pas un service public avec comptes et données séparés. Le pont privé des agents CLI de l'auteur n'est pas inclus. La galerie de sites et les réglages principaux sont en français ; certaines autres applications, les aides et les consignes originales de certains prompts restent en anglais. Consulter [SECURITY.md](SECURITY.md) pour les détails.

## Contribuer et crédits

[Contribuer](CONTRIBUTING.md) · [Documentation anglaise](README.en.md) · [Licence MIT](LICENSE) · [Licences tierces](THIRD_PARTY_NOTICES.md) · [Documentation historique amont](README.upstream.md)

Projet original : **Techdread / Peter Edwards**. Les mentions originales et les licences des bibliothèques sont conservées. Ce fork ajoute l'installation Docker, l'authentification locale, le coffre serveur et la traduction française de l'interface principale.

## Défi GTA VI en monde ouvert

La série **Simulations complexes** propose **GTA VI — monde ouvert réaliste, défi extrême** : un cahier des charges original en français de 24 exigences, couvrant neuf secteurs, quatre classes de véhicules, huit missions, police, trois intérieurs, économie, météo, sauvegarde et diagnostics. Les variantes Base et Avancés restent disponibles avec leurs consignes d’origine.

Ce défi vise un prototype navigateur ambitieux en un document HTML ; il ne promet ni le contenu complet ni la qualité graphique du jeu commercial de Rockstar. Les points de contrôle exigent une validation du gameplay et du rendu. Ajouter le prompt ne lance aucune génération et ne modifie pas les budgets de tokens ; les appels et éventuelles corrections restent soumis aux réglages du lot.
