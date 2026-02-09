import { SPE_RULES, AVAILABLE_TD_YEARS } from './constants';

// ==========================================
// FONCTIONS UTILITAIRES
// ==========================================

export const isTrueValue = (val) => val === true || val === 'True' || val === 'true' || val === '1';

export const isMissing = (val) => val === null || val === undefined || val === '' || val === '-';

export const translateManagementType = (type) => {
  if (!type) return '-';
  if (type === 'direct') return 'Gestion directe';
  if (type === 'conceded') return 'Gestion concédée';
  return type;
};

export const hasMultipleSectors = (sectorList) => {
  if (!sectorList) return false;
  return sectorList.includes(',') || sectorList.includes(';') || sectorList.includes('|');
};

export const formatPct = (pct) => {
  const num = parseFloat(pct);
  if (isNaN(num)) return '0 %';
  return num % 1 === 0 ? `${Math.round(num)} %` : `${num.toFixed(1)} %`;
};

export const formatNumber = (num) => {
  return num.toLocaleString('fr-FR');
};

export const formatLastUpdate = (dateStr) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Normalisation de chaîne pour comparaison
export const normalizeString = (str) => {
  if (!str) return '';
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
};

// Normaliser un nom pour le fichier (supprimer accents et caractères spéciaux)
export const normalizeFilename = (str) => {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
};

// Classification SPE d'un établissement
// Retourne: 'BLANC' (SPE confirmé) ou 'ORANGE' (à vérifier)
// Note: La catégorie NOIR a été supprimée pour éviter les faux positifs
export const classifyEstablishment = (row, apiEntrepriseData) => {
  if (!row) return 'ORANGE';

  const siret = row.siret ? row.siret.toString().trim() : '';
  const secteur = row.sector_list || '';
  const normalizedSecteur = normalizeString(secteur);
  const normalizedName = normalizeString(row.name || '');
  const lineMinistry = row.line_ministry || '';

  // Récupérer la catégorie juridique depuis l'API entreprise
  let cj = '';
  if (apiEntrepriseData && apiEntrepriseData.categorie_juridique) {
    cj = apiEntrepriseData.categorie_juridique.toString();
  }

  // Code 72 = Collectivités territoriales → toujours à vérifier (pas SPE)
  if (cj.startsWith('72')) return 'ORANGE';

  // ==========================================
  // RÈGLES BLANC (SPE confirmé)
  // ==========================================

  // 1. AFPA = établissement public de l'État
  const isAFPA = normalizedName.includes('afpa') ||
    normalizedName.includes('agence nationale pour la formation professionnelle des adultes');
  if (isAFPA) return 'BLANC';

  // 2. Justice : établissements pénitentiaires et mess
  if (lineMinistry === 'Justice') {
    // Vérifier les patterns textuels
    const hasJusticePattern = SPE_RULES.justice_patterns.some(pattern =>
      normalizedName.includes(normalizeString(pattern))
    );
    if (hasJusticePattern) return 'BLANC';

    // Vérifier les acronymes (avec délimiteurs de mots)
    const hasJusticeAcronym = SPE_RULES.justice_acronyms.some(acronym => {
      const regex = new RegExp(`\\b${acronym}\\b`, 'i');
      return regex.test(row.name || '');
    });
    if (hasJusticeAcronym) return 'BLANC';
  }

  // 3. Opérateurs de l'État reconnus
  const hasOperatorMatch = SPE_RULES.operateurs_etat.some(op =>
    normalizedSecteur.includes(normalizeString(op)) ||
    normalizedName.includes(normalizeString(op))
  );
  if (hasOperatorMatch) return 'BLANC';

  // 4. Secteur RIA ou inter-administratif
  const hasRiaMatch = normalizedSecteur.includes('ria') ||
    normalizedSecteur.includes('inter-administratif');
  if (hasRiaMatch) return 'BLANC';

  // 5. Préfixe SIRET de l'État (11, 17, 18, 19)
  const isSiretEtat = SPE_RULES.siret_prefixes_etat.some(p => siret.startsWith(p));
  if (isSiretEtat) return 'BLANC';

  // 6. Secteur clairement État
  const isSecteurEtat = SPE_RULES.secteurs_etat.some(s =>
    normalizedSecteur.includes(normalizeString(s))
  );
  if (isSecteurEtat) return 'BLANC';

  // 7. Code nature juridique SPE
  const isCodeBlanc = SPE_RULES.codes_blanc.prefixes.some(p => cj.startsWith(p)) ||
    SPE_RULES.codes_blanc.exacts.includes(cj);
  if (isCodeBlanc) return 'BLANC';

  // ==========================================
  // Par défaut: à vérifier
  // ==========================================
  return 'ORANGE';
};

// Détection des années de télédéclaration dans les colonnes
export const detectDeclarationColumns = (dataRows) => {
  if (!dataRows || dataRows.length === 0) return AVAILABLE_TD_YEARS;
  const years = new Set(AVAILABLE_TD_YEARS);
  const firstRow = dataRows[0];
  const minYear = Math.min(...AVAILABLE_TD_YEARS.map(Number));
  const maxYear = Math.max(...AVAILABLE_TD_YEARS.map(Number));

  Object.keys(firstRow).forEach(key => {
    const match = key.match(/(\d{4})/);
    if (match) {
      const year = parseInt(match[1]);
      if (year >= minYear && year <= maxYear) {
        years.add(match[1]);
      }
    }
  });

  return Array.from(years).sort();
};

// Vérifier si une télédéclaration existe pour une année donnée
export const hasTeledeclaration = (row, yearId) => {
  if (!row || !yearId) return false;

  for (const key of Object.keys(row)) {
    if (key.includes(yearId) && isTrueValue(row[key])) return true;
  }
  return false;
};
