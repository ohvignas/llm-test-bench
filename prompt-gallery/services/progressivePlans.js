// Curated steps apply only to the exact original brief; edited prompts retain their own instructions.
export const CURATED_PLANS = {
  "games-gta-vi": {
    "sourcePrompt": "Crée un jeu urbain 3D original à la troisième personne, inspiré de l’ambiance réaliste de GTA IV. Livre une petite portion de ville réellement jouable, très soignée, plutôt qu’une grande carte simplifiée. Priorité : qualité du personnage humain, des animations et du quartier, puis conduite et mission.\n\nDIRECTION VISUELLE\nRéférence décrite d’après des captures de GTA IV : rues denses bordées de briques et de commerces, structures métalliques de métro aérien, trottoirs usés, vitrines en retrait, éclairage naturel légèrement désaturé et profondeur atmosphérique. Les personnages ont des proportions humaines, des visages modelés et des vêtements avec du volume. Recrée ces caractéristiques avec des noms et des éléments originaux. Cette description est la référence disponible : aucune photographie ni ressource 3D n’est jointe à la requête ; ne prétends pas les avoir consultées.\n\nEXIGENCES\n1. Personnage humain 3D vu de près : tête avec crâne, mâchoire, nez, yeux, oreilles et cheveux ; cou, épaules, torse, bassin, mains et chaussures proportionnés. Construis des maillages arrondis à sections variables, avec normales lissées et articulations raccordées. La veste possède col, manches et plis ; pantalon, peau et chaussures ont des matières différentes. Évite les membres rectangulaires, les têtes cubiques et les assemblages de blocs. Un visage collé sur un cube ou une silhouette faite de boîtes ne satisfait pas la demande. Prévois repos, marche et course avec flexion des coudes/genoux, transfert du poids et pieds qui suivent le déplacement. La caméra rapprochée doit permettre d’évaluer le modèle.\n2. Quartier compact : deux rues, un carrefour et quelques façades distinctes à échelle humaine. Ajoute encadrements, corniches, portes, vitrines, escaliers, lampadaires, marquages, poubelles et petites irrégularités. Les volumes simples servent de structure interne, pas de façade finale. Travaille les textures, la rugosité, les reflets mesurés, l’ombre de contact et la lumière directionnelle. N’utilise pas un brouillard épais pour cacher une scène vide. Conserve une lumière de fin d’après-midi lisible.\n3. ZQSD/WASD, marche, sprint, saut, gravité et collisions ; caméra souris par glisser-déplacer et flèches, sans verrouillage obligatoire du pointeur. Ajoute deux piétons avec le même soin de modélisation, variantes de vêtements et parcours simples sur les trottoirs. Le personnage reste visible au lancement et ne traverse pas le décor.\n4. Une berline détaillée : carrosserie arrondie, habitacle, vitres, phares et roues orientables. E pour entrer/sortir, accélérer, freiner, reculer et tourner ; caméra et collisions cohérentes. Une mission complète de livraison avec contact, destination visible sur la minimap, succès, échec et recommencement. Ajoute une poursuite policière simple, lisible et limitée à une patrouille. Aucun besoin de multiplier les véhicules, quartiers ou missions avant que cette boucle fonctionne.\n5. Interface française discrète, Jouer, aide, pause/reprise et redémarrage. La pause arrête la simulation. Le HUD décrit l’objectif et les commandes disponibles. Un mode inspection rapproche et fait tourner la caméra autour du personnage sans remplacer le jeu. Affiche clairement toute erreur WebGL ou shader et propose un diagnostic FPS mesuré. Vérifie démarrage, silhouette, marche, caméra, collision, entrée/sortie de voiture, mission et pause. Garde le niveau de détail humain lors des ajouts.\n\nLIVRAISON\nUn document HTML complet avec CSS, shaders GLSL et JavaScript intégrés, terminé par </html>. JavaScript natif avec WebGL 2 ; Canvas 2D peut produire des textures. Sans Three.js ni moteur externe. TypeScript possible à la conception, mais livre le JavaScript déjà compilé et exécutable. Toutes les ressources nécessaires sont intégrées ou générées dans le document : pas d’URL de modèle inventée, de téléchargement demandé ni de ressources du jeu commercial supposées présentes. Fonctionne dans une iframe sandbox=\"allow-scripts\" ; aucune dépendance au stockage, aux popups ou à la page parente. Retourne directement le code, sans plan de développement. Consacre les détails au rendu visible et au jeu utilisable ; n’annonce pas une qualité photoréaliste si le résultat ne la montre pas.",
    "steps": [
      {
        "id": "world",
        "title": "Personnage humain détaillé et première rue",
        "prompt": "Personnage original aux proportions humaines : visage modelé (crâne, mâchoire, nez, yeux, oreilles), cheveux, cou, mains et chaussures ; veste avec col et plis, pantalon. Maillages arrondis à sections variables, normales lissées, articulations raccordées. Aucune tête cubique ni membres rectangulaires. Animations repos/marche/course avec flexion des genoux et coudes, sans glissement des pieds. Une caméra d’inspection permet de voir le visage et les vêtements de près. Crée une petite rue avec trottoir, deux façades en briques et vitrines en retrait, sol texturé et éclairage de fin d’après-midi. Le personnage est visible dès le démarrage. Ajoute Jouer, ZQSD/WASD, sprint, saut, collisions, caméra par glisser-déplacer et flèches, pause/reprise. Cette première scène doit être jouable et déjà montrer la qualité humaine demandée. Ne développe pas encore véhicules, piétons, mission ou police.",
        "maxTokens": 12288
      },
      {
        "id": "visuals",
        "title": "Quartier réaliste et lumière",
        "prompt": "Enrichis la rue en petit quartier à deux rues et un carrefour. Référence décrite : ambiance GTA IV, briques usées, vitrines en retrait, commerces et structure de métro aérien. Façades variées avec encadrements, corniches et escaliers ; trottoirs, lampadaires, marquages et mobilier à échelle humaine. Ajoute textures, normales, matériaux distincts, lumière directionnelle, ombres et légère profondeur atmosphérique. Garde le personnage détaillé et visible ; pas de façades finales en cubes nus ni de brouillard masquant une scène vide. Ne multiplie pas les systèmes de météo.",
        "maxTokens": 12288
      },
      {
        "id": "vehicles",
        "title": "Berline pilotable et piétons",
        "prompt": "Ajoute une seule berline soignée : carrosserie arrondie, habitacle, vitres, phares et roues orientables. E pour entrer/sortir sans téléportation dangereuse, conduite avec accélération, freinage, marche arrière, direction, collisions et caméra adaptée. Ajoute deux piétons reprenant le maillage humain détaillé, avec vêtements différents et parcours sur les trottoirs. Préserve la qualité du personnage, ses contrôles et le rendu de la rue. Aucun bateau, moto ou flotte de véhicules.",
        "maxTokens": 12288
      },
      {
        "id": "action",
        "title": "Patrouille et HUD lisible",
        "prompt": "Ajoute une patrouille policière et un niveau de recherche simple, déclenché par une collision avec la patrouille. Poursuite limitée, perte de contact derrière les bâtiments et retour au calme après un délai visible. HUD français sobre et minimap liée aux coordonnées réelles du joueur, des rues et de la patrouille. Décris le déclencheur dans l’aide. Préserve les maillages et matériaux détaillés ; ne rajoute pas un système complet d’armes.",
        "maxTokens": 12288
      },
      {
        "id": "missions",
        "title": "Mission de livraison complète",
        "prompt": "Ajoute une seule mission originale : rencontrer un contact humain détaillé, prendre une livraison, conduire au point marqué sur la minimap puis revenir. Objectifs successifs, minuterie, réussite réelle, échec et recommencement. Le HUD explique chaque étape et le déclencheur de police reste compréhensible. Chaque bouton et marqueur a un effet réel. Préserve personnage, voiture, piétons, caméra et graphismes.",
        "maxTokens": 12288
      },
      {
        "id": "finish",
        "title": "Finition et contrôle du rendu",
        "prompt": "Vérifie et corrige démarrage, visage et silhouette en mode inspection, marche/course sans glissement des pieds, caméra, collisions, entrée/sortie de voiture, mission, poursuite et pause/reprise. Le redémarrage remet l’état à zéro sans fuite de ressources. Ajoute une aide française concise et FPS réellement mesurés. Conserve les détails humains et les façades en corrigeant les bugs. Affiche une erreur WebGL/shader exploitable ; pas de promesse de qualité du jeu commercial, de faux boutons, de TODO ni de nouvelles fonctionnalités coûteuses.",
        "maxTokens": 12288
      }
    ]
  }
};
