// ==========================================
// CONFIGURATION
// ==========================================
export const API_PROXY = '/.netlify/functions/api-proxy';

// Ressource du Registre National des Cantines (XLSX - le Parquet n'est plus mis à jour depuis le 20/01/2026)
export const DATAGOUV_RESOURCE_ID = '408dca92-9028-4f66-93bf-f671111393ec';
export const DATAGOUV_DATASET_ID = '6482def590d4cf8cea3aa33e';

// Liste des ministères
export const MINISTERES = [
  "Enseignement supérieur et Recherche",
  "Intérieur et Outre-mer",
  "Économie et finances",
  "Agriculture, Alimentation et Forêts",
  "Services du Premier Ministre",
  "Justice",
  "Sport",
  "Environnement",
  "Éducation et Jeunesse",
  "Affaires étrangères",
  "Travail",
  "Culture",
  "Fonction Publiques",
  "Santé et Solidarités",
  "Présidence de la république - Autorités indépendantes (AAI, API)",
  "Cohésion des territoires - Relations avec les collectivités territoriales",
  "Mer"
];

// Liste des régions
export const REGIONS = [
  "Île-de-France",
  "Auvergne-Rhône-Alpes",
  "Nouvelle-Aquitaine",
  "Occitanie",
  "Provence-Alpes-Côte d'Azur",
  "Hauts-de-France",
  "Pays de la Loire",
  "Bretagne",
  "Bourgogne-Franche-Comté",
  "Grand Est",
  "Normandie",
  "Centre-Val de Loire",
  "La Réunion",
  "Corse",
  "Martinique",
  "Guadeloupe",
  "Guyane",
  "Mayotte"
];

// Couleurs pour les graphiques (palette DSFR illustrative)
export const CHART_COLORS = [
  '#000091', // Bleu France
  '#6a6af4', // Bleu cumulé
  '#009081', // Vert menthe
  '#f95c5e', // Rouge marianne
  '#ff9940', // Orange terre battue
  '#a558a0', // Violet glycine
  '#417dc4', // Bleu cumulus
  '#66673d', // Vert bourgeon
];

// Cibles RIA DGAFP par région
export const CIBLE_RIA_DGAFP = {
  "Auvergne-Rhône-Alpes": 12,
  "Bourgogne-Franche-Comté": 4,
  "Bretagne": 5,
  "Centre-Val de Loire": 6,
  "Corse": 1,
  "Grand Est": 12,
  "Hauts-de-France": 4,
  "Île-de-France": 7,
  "Normandie": 7,
  "Nouvelle-Aquitaine": 12,
  "Occitanie": 9,
  "Provence-Alpes-Côte d'Azur": 4,
  "Pays de la Loire": 10
};

// Règles de classification SPE (Services Publics de l'État)
// Documentation: https://www.economie.gouv.fr/daj/services-publics-etat
export const SPE_RULES = {
  // Opérateurs de l'État connus
  operateurs_etat: [
    'INSEE', 'DGFIP', 'DGDDI', 'douane', 'DDFIP', 'DRFIP',
    'DREAL', 'DRAAF', 'DDT', 'DDTM', 'DRAC', 'DIRECCTE',
    'DREETS', 'DDETS', 'ARS', 'DGAC', 'aviation civile',
    'gendarmerie', 'police nationale', 'CRS'
  ],

  // Secteurs clairement liés à l'État (termes spécifiques pour éviter les faux positifs)
  secteurs_etat: [
    'RIA',
    'inter-administratif',
    'administration centrale',
    'administration de l\'etat',
    'ministere',
    'prefecture',
    'sous-prefecture'
  ],

  // Préfixes SIRET de l'État (sans 12 = collectivités territoriales)
  // 11: État central, 17-19: autres services de l'État
  siret_prefixes_etat: ['11', '17', '18', '19'],

  // Codes nature juridique clairement SPE
  codes_blanc: {
    // 71xx: État et établissements publics nationaux
    // 73xx: Établissements publics nationaux à caractère scientifique
    // 74xx: Autres établissements publics nationaux
    prefixes: ['71', '73', '74'],
    exacts: [
      // Syndicats intercommunaux de l'État
      '4110', '4120', '4130', '4140', '4150', '4160',
      // Administrations publiques
      '8411', '8412', '8413',
      // Codes spécifiques État
      '7112', // Autorité constitutionnelle
      '7120', // Services centraux des ministères
      '7150', // Services déconcentrés de l'État
      '7160'  // Autorités administratives indépendantes
    ]
  },

  // Patterns pour établissements Justice
  justice_patterns: [
    'centre penitentiaire',
    'centre de detention',
    'maison d\'arret',
    'maison d arret',
    'etablissement penitentiaire',
    'maison centrale',
    'centre de semi-liberte',
    'etablissement pour mineurs',
    'mess'
  ],

  // Acronymes Justice (avec délimiteurs de mots)
  justice_acronyms: ['cp', 'cd', 'ma', 'mc', 'csl', 'epm']
};

// Années de télédéclaration disponibles (colonnes présentes dans le registre des cantines)
// Les données d'une année N sont publiées lors de la campagne N+1
// Exemple: données 2024 publiées lors de la campagne 2025
export const AVAILABLE_TD_YEARS = ['2021', '2022', '2023', '2024', '2025'];

// Ressources télédéclarations par année (IDs data.gouv.fr)
// Source unique de vérité - utilisé par le proxy et le frontend
export const TD_RESOURCES = {
  '2024': '078cbd12-b553-4d0b-b74c-e79b19f7f61f', // Campagne 2025 sur données 2024
  '2023': '25570c1c-9288-4fed-9d82-0f42444e12ab', // Campagne 2024 sur données 2023
  '2022': '84a09799-0845-4055-9101-e3a1a00fac2f', // Campagne 2023 sur données 2022
  '2021': 'efe63a1a-c307-4238-81b0-ffa8536163c7'  // Campagne 2022 sur données 2021
};

// Codes départements outre-mer (DOM-TOM)
export const DOM_DEPT_CODES = ['971', '972', '973', '974', '976'];

// Pagination API (limite max de l'API tabular data.gouv.fr = 50)
export const API_PAGE_SIZE = 50;

// Limite d'affichage initiale pour les performances
export const INITIAL_DISPLAY_LIMIT = 100;

// ==========================================
// OBJECTIFS EGALIM
// ==========================================
// Loi EGalim (art. 24) - Objectifs pour la restauration collective publique
export const EGALIM_OBJECTIVES = {
  bio: 20,           // 20% minimum de produits bio
  durable: 50        // 50% minimum de produits durables et de qualité (dont bio)
};
