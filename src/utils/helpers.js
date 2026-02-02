import { SPE_RULES } from './constants';

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
export const classifyEstablishment = (row, apiEntrepriseData) => {
  if (!row) return 'ORANGE';

  const siret = row.siret ? row.siret.toString().trim() : '';
  const secteur = row.sector_list || '';
  const normalizedSecteur = normalizeString(secteur);
  const normalizedName = normalizeString(row.name || '');
  const lineMinistry = row.line_ministry || '';

  let cj = '';
  if (apiEntrepriseData && apiEntrepriseData.categorie_juridique) {
    cj = apiEntrepriseData.categorie_juridique || '';
  }

  // AFPA = toujours SPE (établissement public de l'État)
  const isAFPA = normalizedName.includes('afpa') ||
    normalizedName.includes('agence nationale pour la formation professionnelle');
  if (isAFPA) return 'BLANC';

  // Justice : établissements pénitentiaires et mess = SPE
  if (lineMinistry === 'Justice') {
    const justicePatterns = [
      /\bcp\b/i,
      /\bcd\b/i,
      /\bma\b/i,
      /\bmess\b/i,
      /maison\s*d['']?\s*arr[eê]t/i
    ];
    const isJusticeSPE = justicePatterns.some(pattern => pattern.test(row.name || ''));
    if (isJusticeSPE) return 'BLANC';
  }

  const hasOperatorMatch = SPE_RULES.operateurs_etat.some(op =>
    normalizedSecteur.includes(normalizeString(op)) ||
    normalizedName.includes(normalizeString(op))
  );

  const hasRiaMatch = normalizedSecteur.includes('ria') || normalizedSecteur.includes('inter-administratif');
  const hasEtatMatch = normalizedSecteur.includes('etat') || normalizedSecteur.includes('état');

  // Fix A9: Ajouter hasEtatMatch dans la condition ORANGE pour code 72
  if ((hasOperatorMatch || hasRiaMatch || hasEtatMatch) && cj.startsWith('72')) return 'ORANGE';
  if (hasOperatorMatch || hasRiaMatch || hasEtatMatch) return 'BLANC';

  const isSiretEtat = SPE_RULES.siret_prefixes_etat.some(p => siret.startsWith(p));
  if (isSiretEtat && !cj.startsWith('72')) return 'BLANC';

  const isSecteurEtat = SPE_RULES.secteurs_etat.some(s => normalizedSecteur.includes(normalizeString(s)));
  if (isSecteurEtat && !cj.startsWith('72')) return 'BLANC';

  const isCodeBlanc = SPE_RULES.codes_blanc.prefixes.some(p => cj.startsWith(p)) ||
    SPE_RULES.codes_blanc.exacts.includes(cj);
  if (isCodeBlanc) return 'BLANC';

  const isCodeNoir = SPE_RULES.codes_noir.prefixes.some(p => cj.startsWith(p)) ||
    SPE_RULES.codes_noir.exacts.includes(cj);
  if (isCodeNoir) return 'NOIR';

  return 'ORANGE';
};

// Détection des années de télédéclaration dans les colonnes
export const detectDeclarationColumns = (dataRows) => {
  if (!dataRows || dataRows.length === 0) return ['2021', '2022', '2023', '2024'];
  const years = new Set(['2021', '2022', '2023', '2024']);
  const firstRow = dataRows[0];

  Object.keys(firstRow).forEach(key => {
    const match = key.match(/(\d{4})/);
    if (match && parseInt(match[1]) >= 2021 && parseInt(match[1]) <= 2025) {
      years.add(match[1]);
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
