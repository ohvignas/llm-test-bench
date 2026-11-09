# Version locale sécurisée et française

Demande : fork sur le compte GitHub de l'utilisateur, connexion par identifiant/mot de passe, conservation de la clé OpenRouter, Docker local, interface française.

La version d'origine est statique et garde les clés dans le navigateur ou le dossier choisi. Cette version ajoute Flask, SQLite et un coffre Fernet. La clé de chiffrement et la base utilisent deux volumes Docker distincts. Aucun secret n'est ajouté à Git. Le premier compte est créé dans l'interface locale ; les sessions sont conservées côté serveur avec cookie HttpOnly et protection CSRF. L'inscription devient indisponible après création du compte unique.

Les appels OpenRouter passent par un proxy authentifié à destination fixe. Le navigateur ne reçoit jamais la clé enregistrée. Les projets et les réglages utilisent l'API de dossier serveur existante et le volume de données. Le déploiement écoute sur 127.0.0.1:8085. Aucun déploiement public n'est demandé.

Les outils existants restent disponibles. Les deux modules auparavant bloqués sont réactivés : le déplacement du secret côté serveur traite l'accès direct à la clé, mais du code exécuté dans la page principale reste à considérer comme du code de confiance pour ses actions sur la session. Les aperçus HTML gardent leur isolation. Les statistiques Cloudflare sont retirées à la distribution locale et les exemples directs conservent leur CSP sandbox.

La traduction porte sur l'interface et ses réglages, jamais sur les prompts, les identifiants de modèles ou le code produit. Le contenu d'aide et les briefs provenant de l'amont peuvent rester anglais. Les identifiants sont choisis par l'utilisateur, aucun mot de passe de démonstration ne doit rester dans l'installation réelle.

Vérification : tests serveur sur comptes/sessions/CSRF/coffre/persistance/proxy/chemins, tests du pont navigateur, tests existants pertinents, compilation et santé Docker, essai de l'interface sur une instance jetable. Le conteneur final doit rester en marche avec l'écran de création du compte si l'utilisateur ne l'a pas encore créé.
