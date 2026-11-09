# Sauvegarde, restauration et récupération / Operations

[Français](../README.md) · [English](../README.en.md)

Exécuter ces commandes dans le dossier qui contient `compose.yaml`. Aucun Python sur l'ordinateur n'est requis. / Run all commands from the folder containing `compose.yaml`; host Python is not required.

## Sauvegarder / Back up

Choisir un dossier `backup` qui n'existe pas encore, ou un nouveau nom pour chaque sauvegarde. L'arrêt temporaire garantit que la base et les projets ne changent pas pendant leur copie. / Use a new backup folder. Briefly stopping the app keeps the database and project files consistent.

```sh
docker compose stop
mkdir backup
docker compose cp bench:/data/. ./backup/data
docker compose cp bench:/secrets/. ./backup/secrets
docker compose start
```

Vérifier la présence de `backup/data/app.sqlite3`, de `backup/data/files` et de `backup/secrets/vault.key`. Conserver les deux dossiers ensemble dans un emplacement privé. La sauvegarde contient la base et la clé permettant de déchiffrer le secret OpenRouter : ne pas la publier dans une issue, Git ou un dossier public. `backup/` et `backups/` sont exclus de Git et des images Docker.

Check for `backup/data/app.sqlite3`, `backup/data/files`, and `backup/secrets/vault.key`. Keep both directories together and private. Someone with the database and encryption key can decrypt the saved API credential. Do not publish backups. Both backup folder names are excluded from Git and Docker build contexts.

La sauvegarde reste sur l'ordinateur. Une copie sur un autre disque protège contre la perte de cet ordinateur. / Keep another copy on a separate device to protect against losing the computer.

## Restaurer sur une nouvelle installation / Restore to a fresh installation

Utiliser une sauvegarde de confiance. Ces commandes visent une installation neuve sans données à conserver ; elles remplaceraient les fichiers de même nom d'une installation existante. Elles ne fusionnent pas deux bases. / Use a trusted backup and fresh, empty installation: this replaces matching files, it does not merge databases.

1. Cloner le dépôt et placer le dossier `backup` à sa racine.
2. Si besoin, préparer le port dans `.env`, comme décrit dans le README.
3. Créer le conteneur et les volumes sans démarrer l'application, puis copier les données :

```sh
docker compose build
docker compose create
docker compose cp ./backup/data/. bench:/data
docker compose cp ./backup/secrets/. bench:/secrets
docker compose run --rm --no-deps --user 0 --cap-add CHOWN --cap-add DAC_OVERRIDE --entrypoint chown bench -R 10001:10001 /data /secrets
docker compose up -d --wait
```

La commande `chown` remet la propriété des fichiers au compte non privilégié du conteneur après la copie Docker. Elle vise seulement les deux volumes de cette installation ; les capacités CHOWN et DAC_OVERRIDE ne sont ajoutées qu’à ce conteneur de maintenance, pas à l’application. Reprendre les identifiants de la sauvegarde ; il n'y a pas de création d'un nouveau compte. Le port appartient à `.env`, pas à la sauvegarde : on peut le choisir sur la nouvelle machine. / The ownership command makes restored files readable by the non-root app user. Sign in with the restored account; port configuration stays local to `.env`.

## Mot de passe oublié / Forgotten password

Avec Docker en marche :

```sh
docker compose exec bench python -m server.manage reset-password
```

Saisir deux fois un nouveau mot de passe de 12 caractères minimum. La saisie reste masquée ; aucun mot de passe n'est passé dans la ligne de commande. Le terminal affiche l'identifiant. Les sessions sont fermées, mais les projets et la clé OpenRouter sont conservés.

Enter a new password of at least 12 characters twice. Input is hidden and no password is passed as a command-line argument. The command prints the username, revokes existing sessions, and preserves projects and the encrypted API key. This is local administration available to someone who controls this Docker installation; there is no public reset endpoint.

## Changer d'ordinateur / Move to another computer

Sauvegarder les deux volumes, installer Docker sur la nouvelle machine puis restaurer. Les préférences de navigateur non synchronisées, les permissions de capture vidéo et les dossiers sélectionnés manuellement peuvent devoir être reconfigurés. / Back up both volumes, install Docker on the new computer and restore. Browser permissions and manually selected local folders may need reconnecting.

## Supprimer les données / Remove data

`docker compose stop` et `docker compose down` sans suppression des volumes conservent les données. Supprimer les volumes dans Compose ou Docker Desktop efface leur contenu. Aucun effacement n'est nécessaire pour mettre à jour, changer de port ou récupérer un mot de passe.

`docker compose stop` and `docker compose down` without volume deletion preserve data. Removing volumes deletes their contents. Updates, port changes and password recovery do not require deleting volumes.
