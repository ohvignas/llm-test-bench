# Agent Mastra pour Prompt Gallery

Demande autorisée : un agent de développement par couple prompt/modèle, capable d'utiliser des outils. L'interface existante et OpenRouter restent les points d'entrée.

Le mode par défaut devient Agent Mastra. Le serveur Python possède la clé, l'authentification, les appels facturés, les coûts et les points de reprise. Un service Node interne héberge Mastra. Chaque session reçoit un conteneur Docker jetable sans réseau, sans secret, sans montage hôte, sans socket Docker. Seul le service de contrôle de confiance accède au socket pour créer ces conteneurs avec des options fixes. Les outils lisent/écrivent des fichiers et exécutent des commandes dans le conteneur de la session. Ils peuvent construire une application HTML/JavaScript/TypeScript avec Vite et les dépendances fournies. Aucun shell n'est exécuté dans les services Python ou Mastra.

Un jeton éphémère lie chaque requête du fournisseur au modèle et à l'exécution autorisés. Le serveur applique huit appels maximum et un budget de 10 USD par prompt/modèle par défaut, modifiables avant lancement. Il réserve le coût maximal selon les prix du catalogue avant chaque appel. Une facture absente bloque la poursuite, sans être comptée comme zéro. Les paramètres de raisonnement et de sortie restent ceux affichés ; ils ne sont pas abaissés silencieusement. SDK retries et réparations implicites sont désactivés. Les limites ne déclenchent aucun nouveau lot automatique.

Chaque résultat d'outil, étape facturée, code construit et fichiers sources est conservé. Les fichiers sont chiffrés dans SQLite. La comparaison reçoit les sorties compilées, peut être rechargée pendant le travail et montre les outils en direct. Reprise et chat utilisent les sources de la tentative précédente. Un arrêt annule le fournisseur et détruit le conteneur après sauvegarde des fichiers disponibles. Les autres sessions continuent.

Validation : vrai moteur Mastra avec fournisseur HTTP simulé, outils Docker réels sans clé, tests d'authentification et d'isolation, tests serveur existants, métriques multietapes et flux navigateur. Aucun appel OpenRouter payant n'est requis pour vérifier l'intégration technique.
