# Prompt GTA : personnages et quartier réalistes

Le prompt unique `games-gta-vi` reste dans **Base → Jeux et graphismes**. Son titre français est **GTA VI — personnages 3D réalistes, ambiance GTA IV**. Le nom de dossier historique est conservé pour ne pas renommer les résultats des autres installations.

## Forme du brief

Les prompts `2048`, `Verlet Ragdoll Playground` et `Isometric City Builder` du projet définissent un livrable, une boucle jouable et des comportements précis. La version avancée d’`Isometric City Builder` les organise en exigences numérotées et ajoute des points de contrôle. Le nouveau brief GTA suit cette structure : objectif visuel, cinq exigences concrètes, format de livraison et critères d’évaluation.

La priorité passe d’un grand catalogue de systèmes à un humain détaillé dans deux rues soignées, une berline et une mission complète. La modélisation du visage, des vêtements et des articulations est demandée dès la première étape, et doit être conservée dans les suivantes. Les personnages cubiques ne satisfont pas les critères, même si les commandes fonctionnent.

## Références visuelles

- [GTA IV, page officielle Rockstar et rubrique Screens](https://www.rockstargames.com/games/IV).
- [Galerie de captures officielles GTA IV publiée par GTABase](https://www.gtabase.com/grand-theft-auto-iv/screenshots/gta-4/).
- [Capture de rue : Niko sous le métro aérien](https://www.windowscentral.com/grand-theft-auto-iv-and-episodes-liberty-city-come-xbox-backward-compatibility).
- [Capture rapprochée du personnage et de ses vêtements](https://www.igrandtheftauto.com/gta4/images/21-gtaiv-niko-points-his-gun-at-someone-off-screen).

Traits retenus dans la description : échelle humaine, briques et commerces, structures métalliques du métro aérien, usure des surfaces, palette modérée, profondeur atmosphérique et personnages habillés aux silhouettes naturelles. Les références sont des repères artistiques ; leurs médias ne sont pas intégrés au dépôt ni utilisés comme textures.

## Ce que reçoit le modèle

La requête actuelle transmet **du texte**, avec la description visuelle ci-dessus. Elle ne transmet pas les photographies et ne donne pas au modèle un navigateur ni un accès automatique à des fichiers 3D. Le prompt le dit explicitement. Aucun nouveau paiement n’est déclenché par sa modification.

Le format autonome JavaScript/WebGL 2 sans moteur externe est conservé. Un personnage détaillé peut être demandé avec des maillages à sections variables et des normales lissées, mais cela ne garantit pas un résultat photoréaliste. Un rendu proche d’un jeu commercial demande généralement des personnages sculptés et texturés, un squelette, des animations et un travail artistique dédié. Pour utiliser de telles ressources à l’avenir, il faudra les fournir, vérifier leur licence et intégrer leur chargement ; écrire simplement « hyperréaliste » ne les crée pas.

## Contrôle du résultat

1. Inspecter de près visage, silhouette, mains, chaussures, vêtements et raccords d’articulations.
2. Vérifier marche/course, glissement des pieds, caméra et collisions.
3. Examiner façades, variété des matériaux, éclairage et ombres sans brouillard masquant les défauts.
4. Essayer entrée/sortie du véhicule, conduite, objectif de livraison, échec/reprise et pause.
5. Évaluer le rendu séparément de l’absence d’erreurs JavaScript : un test technique réussi ne valide pas le réalisme.

Les six étapes optionnelles sont désormais : humain et première rue ; quartier et lumière ; voiture et piétons ; patrouille et HUD ; livraison ; finition. Chaque étape reste un appel potentiellement facturé. La sauvegarde des versions et les plafonds existants ne changent pas. Aucune génération payante n’a servi à valider cette révision du prompt.
