import { useState, useEffect, useMemo, useCallback } from 'react';
import { PieChart } from './PieChart';
import { EstablishmentsMap } from './EstablishmentsMap';
import { CampaignBanner } from './CampaignBanner';
import { useDebounce } from '../hooks/useDebounce';
import {
  API_PROXY,
  DATAGOUV_RESOURCE_ID,
  DATAGOUV_DATASET_ID,
  MINISTERES,
  REGIONS,
  CIBLE_RIA_DGAFP,
  AVAILABLE_TD_YEARS,
  TD_RESOURCES,
  API_PAGE_SIZE,
  INITIAL_DISPLAY_LIMIT,
  EGALIM_OBJECTIVES
} from '../utils/constants';
import {
  isTrueValue,
  isMissing,
  translateManagementType,
  hasMultipleSectors,
  formatPct,
  formatNumber,
  formatLastUpdate,
  normalizeFilename,
  detectDeclarationColumns,
  hasTeledeclaration
} from '../utils/helpers';

export function App() {
  // États
  const [mode, setMode] = useState('ministere');
  const [selectedMinistere, setSelectedMinistere] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [data, setData] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState('');
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [availableYears, setAvailableYears] = useState(AVAILABLE_TD_YEARS);
  const [selectedYear, setSelectedYear] = useState('2024');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSecteurs, setSelectedSecteurs] = useState([]);
  const [downloading, setDownloading] = useState(null);

  // Télédéclarations EGalim
  const [teledeclarations, setTeledeclarations] = useState({});
  const [loadingTD, setLoadingTD] = useState(false);

  // Limite d'affichage pour les performances
  const [displayLimit, setDisplayLimit] = useState(INITIAL_DISPLAY_LIMIT);

  // Debounce sur la recherche (D5)
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // ==========================================
  // CHARGEMENT DES DONNÉES
  // ==========================================

  // Date de mise à jour (utiliser created_at de l'API tabular pour cohérence avec data.gouv.fr)
  useEffect(() => {
    const fetchLastUpdate = async () => {
      // Priorité 1: Date de disponibilité dans l'API tabular (cohérent avec le site data.gouv.fr)
      try {
        const tabularResponse = await fetch(`https://tabular-api.data.gouv.fr/api/resources/${DATAGOUV_RESOURCE_ID}/`);
        if (tabularResponse.ok) {
          const tabularData = await tabularResponse.json();
          if (tabularData.created_at) {
            setLastUpdate(tabularData.created_at);
            return;
          }
        }
      } catch (e) {
        console.warn('API tabular non accessible (CORS), fallback dataset API');
      }

      // Fallback: last_update du dataset
      try {
        const response = await fetch(`https://www.data.gouv.fr/api/1/datasets/${DATAGOUV_DATASET_ID}/`);
        if (response.ok) {
          const data = await response.json();
          if (data.last_update) {
            setLastUpdate(data.last_update);
            return;
          }
          // Fallback: last_modified de la ressource spécifique
          const resource = data.resources?.find(r => r.id === DATAGOUV_RESOURCE_ID);
          if (resource?.last_modified) {
            setLastUpdate(resource.last_modified);
          }
        }
      } catch (e) {
        console.error('Erreur date MAJ:', e);
      }
    };
    fetchLastUpdate();
  }, []);

  // Données principales
  useEffect(() => {
    const fetchData = async () => {
      if (mode === 'ministere' && !selectedMinistere) return;
      if (mode === 'region' && !selectedRegion) return;

      setLoading(true);
      setError(null);
      setDisplayLimit(INITIAL_DISPLAY_LIMIT);

      try {
        let allData = [];
        let currentPage = 1;
        let hasMore = true;
        let totalRecords = 0;

        while (hasMore) {
          const params = new URLSearchParams();

          if (mode === 'ministere') {
            params.append('line_ministry__exact', selectedMinistere);
          } else {
            params.append('line_ministry__exact', "Préfecture - Administration Territoriale de l'État (ATE)");
            params.append('region_lib__exact', selectedRegion);
          }

          params.append('page', currentPage);
          params.append('page_size', API_PAGE_SIZE);

          if (totalRecords > 0) {
            const totalPages = Math.ceil(totalRecords / API_PAGE_SIZE);
            setLoadingProgress(`${allData.length} / ${totalRecords} établissements (page ${currentPage}/${totalPages})`);
          } else {
            setLoadingProgress(`Récupération des données...`);
          }

          const response = await fetch(`${API_PROXY}?${params.toString()}`);
          if (!response.ok) throw new Error(`Erreur API: ${response.status}`);

          const result = await response.json();
          const pageData = result.data || [];
          totalRecords = result.meta?.total || result.total_count || 0;

          if (currentPage === 1) {
            const years = detectDeclarationColumns(pageData);
            setAvailableYears(years);
            if (years.length > 0) {
              setSelectedYear(years[years.length - 1]);
            }
          }

          allData = [...allData, ...pageData];
          setLoadingProgress(`${allData.length} / ${totalRecords}`);

          hasMore = allData.length < totalRecords && pageData.length > 0;
          currentPage++;

          if (currentPage > 100) break;
        }

        setData(allData);
        setTotalCount(totalRecords);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
        setLoadingProgress('');
      }
    };

    fetchData();
  }, [mode, selectedMinistere, selectedRegion]);

  // Charger les télédéclarations après le chargement des données principales
  useEffect(() => {
    if (data.length === 0) return;

    const fetchTeledeclarations = async () => {
      setLoadingTD(true);
      const tdMap = {};

      try {
        let allTD = [];
        let currentPage = 1;
        let hasMore = true;

        while (hasMore) {
          const params = new URLSearchParams();
          params.append('source', 'teledeclarations');
          params.append('td_year', selectedYear);

          if (mode === 'ministere') {
            params.append('canteen_line_ministry__exact', selectedMinistere);
          } else {
            params.append('canteen_line_ministry__exact', "Préfecture - Administration Territoriale de l'État (ATE)");
            params.append('canteen_region_lib__exact', selectedRegion);
          }

          params.append('page', currentPage);
          params.append('page_size', 50);

          const response = await fetch(`${API_PROXY}?${params.toString()}`);
          if (!response.ok) break;

          const result = await response.json();
          const pageData = result.data || [];
          const total = result.meta?.total || result.total_count || 0;

          allTD = [...allTD, ...pageData];
          hasMore = allTD.length < total && pageData.length > 0;
          currentPage++;

          if (currentPage > 50) break;
        }

        allTD.forEach(td => {
          const siret = td.canteen_siret;
          if (siret) {
            if (!tdMap[siret]) tdMap[siret] = {};
            tdMap[siret][selectedYear] = {
              ratio_bio: td.teledeclaration_ratio_bio,
              ratio_egalim: td.teledeclaration_ratio_egalim_hors_bio,
              type: td.teledeclaration_type
            };
          }
        });

        setTeledeclarations(tdMap);
      } catch (e) {
        console.error('Erreur chargement TD:', e);
      } finally {
        setLoadingTD(false);
      }
    };

    fetchTeledeclarations();
  }, [data, mode, selectedMinistere, selectedRegion, selectedYear]);

  // ==========================================
  // DONNÉES FILTRÉES ET STATISTIQUES
  // ==========================================
  const filteredData = useMemo(() => {
    let filtered = data;

    if (debouncedSearchQuery) {
      const q = debouncedSearchQuery.toLowerCase();
      filtered = filtered.filter(row =>
        (row.name && row.name.toLowerCase().includes(q)) ||
        (row.siret && row.siret.includes(q)) ||
        (row.city && row.city.toLowerCase().includes(q))
      );
    }

    if (selectedSecteurs.length > 0) {
      filtered = filtered.filter(row =>
        selectedSecteurs.some(s => row.sector_list && row.sector_list.includes(s))
      );
    }

    return filtered;
  }, [data, debouncedSearchQuery, selectedSecteurs]);

  const availableSecteurs = useMemo(() => {
    const secteurs = new Set();
    data.forEach(row => {
      if (row.sector_list) {
        row.sector_list.split(/[,;|]/).forEach(s => {
          const trimmed = s.trim();
          if (trimmed) secteurs.add(trimmed);
        });
      }
    });
    return Array.from(secteurs).sort();
  }, [data]);

  // Statistiques principales
  const stats = useMemo(() => {
    const totalApi = totalCount > 0 ? totalCount : data.length;
    const totalFiltered = filteredData.length;

    const td = {};
    availableYears.forEach(yearId => {
      const count = filteredData.filter(d => hasTeledeclaration(d, yearId)).length;
      td[yearId] = {
        count,
        pct: totalFiltered > 0 ? ((count / totalFiltered) * 100).toFixed(1) : 0
      };
    });

    const actifs = filteredData.filter(d => isTrueValue(d.active_on_ma_cantine)).length;

    return {
      totalApi,
      totalFiltered,
      td,
      actifs: { count: actifs, pct: totalFiltered > 0 ? (actifs / totalFiltered * 100).toFixed(1) : 0 }
    };
  }, [data, filteredData, totalCount, availableYears]);

  // Stats RIA (mode ATE)
  const riaStats = useMemo(() => {
    if (mode !== 'region' || !selectedRegion) return null;
    const riaCount = filteredData.filter(row => {
      const sector = row.sector_list || '';
      return sector.includes('RIA') || sector.includes('inter-administratif');
    }).length;
    const cible = CIBLE_RIA_DGAFP[selectedRegion] || 0;
    const pct = cible > 0 ? ((riaCount / cible) * 100).toFixed(1) : 0;
    return { count: riaCount, cible, pct };
  }, [mode, selectedRegion, filteredData]);

  // Stats erreurs avec score qualité
  const errorStats = useMemo(() => {
    const errors = {
      no_active_manager: 0, siret: 0, name: 0, daily_meal_count: 0,
      production_type: 0, management_type: 0, economic_model: 0,
      economic_model_private: 0, multiple_sectors: 0
    };
    let total = 0;

    filteredData.forEach(row => {
      let hasError = false;

      if (!isTrueValue(row.active_on_ma_cantine)) { errors.no_active_manager++; hasError = true; }
      if (isMissing(row.siret)) { errors.siret++; hasError = true; }
      if (isMissing(row.name)) { errors.name++; hasError = true; }
      if (isMissing(row.daily_meal_count)) { errors.daily_meal_count++; hasError = true; }
      if (isMissing(row.production_type)) { errors.production_type++; hasError = true; }
      if (isMissing(row.management_type)) { errors.management_type++; hasError = true; }
      if (isMissing(row.economic_model)) { errors.economic_model++; hasError = true; }
      else if (row.economic_model !== 'public') { errors.economic_model_private++; hasError = true; }
      if (hasMultipleSectors(row.sector_list)) { errors.multiple_sectors++; hasError = true; }

      if (hasError) total++;
    });

    // Score qualité: (établissements avec au moins une erreur / total) * 100
    const qualityScore = filteredData.length > 0
      ? Math.round((total / filteredData.length) * 100)
      : 0;

    return { errors, total, qualityScore };
  }, [filteredData]);

  // Stats par type de gestion
  const managementStats = useMemo(() => {
    const groups = {};
    filteredData.forEach(d => {
      const type = translateManagementType(d.management_type) || 'Non renseigné';
      groups[type] = (groups[type] || 0) + 1;
    });
    return Object.entries(groups)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredData]);

  // Stats par région (mode ministère)
  const regionStats = useMemo(() => {
    if (mode !== 'ministere') return [];
    const groups = {};
    filteredData.forEach(d => {
      const region = d.region_lib || 'Non renseigné';
      groups[region] = (groups[region] || 0) + 1;
    });
    return Object.entries(groups)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredData, mode]);

  // Moyennes repas
  const mealStats = useMemo(() => {
    const validDaily = filteredData.filter(d => d.daily_meal_count && !isNaN(d.daily_meal_count));
    const avgDaily = validDaily.length > 0
      ? Math.round(validDaily.reduce((sum, d) => sum + Number(d.daily_meal_count), 0) / validDaily.length)
      : 0;

    const validYearly = filteredData.filter(d => d.yearly_meal_count && !isNaN(d.yearly_meal_count));
    const avgYearly = validYearly.length > 0
      ? Math.round(validYearly.reduce((sum, d) => sum + Number(d.yearly_meal_count), 0) / validYearly.length)
      : 0;

    return { avgDaily, avgYearly };
  }, [filteredData]);

  // Statistiques agrégées EGalim
  const egalimStats = useMemo(() => {
    let totalWithData = 0;
    let meetsBioObjective = 0;
    let meetsDurableObjective = 0;

    filteredData.forEach(row => {
      const td = teledeclarations[row.siret]?.[selectedYear];
      if (td && (td.ratio_bio !== null || td.ratio_egalim !== null)) {
        totalWithData++;
        const bio = td.ratio_bio ? Number(td.ratio_bio) * 100 : 0;
        const egalim = td.ratio_egalim ? Number(td.ratio_egalim) * 100 : 0;
        const total = bio + egalim;

        if (bio >= EGALIM_OBJECTIVES.bio) meetsBioObjective++;
        if (total >= EGALIM_OBJECTIVES.durable) meetsDurableObjective++;
      }
    });

    return {
      totalWithData,
      bio: {
        count: meetsBioObjective,
        pct: totalWithData > 0 ? ((meetsBioObjective / totalWithData) * 100).toFixed(0) : 0
      },
      durable: {
        count: meetsDurableObjective,
        pct: totalWithData > 0 ? ((meetsDurableObjective / totalWithData) * 100).toFixed(0) : 0
      }
    };
  }, [filteredData, teledeclarations, selectedYear]);

  // Historique des télédéclarations par année
  const tdHistory = useMemo(() => {
    return availableYears.map(year => {
      const count = filteredData.filter(d => hasTeledeclaration(d, year)).length;
      return { year, count };
    });
  }, [filteredData, availableYears]);

  // Vérifier si les données de télédéclaration détaillées sont disponibles pour l'année sélectionnée
  // Les données détaillées (Bio, Qualité, etc.) viennent des ressources TD_RESOURCES
  // qui peuvent ne pas exister encore pour les années récentes (ex: 2025)
  const isTDDataAvailable = useMemo(() => {
    return TD_RESOURCES.hasOwnProperty(selectedYear);
  }, [selectedYear]);

  // Style de ligne tableau
  const getRowClassName = useCallback((row) => {
    const hasError = !isTrueValue(row.active_on_ma_cantine) ||
      isMissing(row.siret) || isMissing(row.name) ||
      isMissing(row.daily_meal_count) || isMissing(row.production_type) ||
      isMissing(row.management_type) || isMissing(row.economic_model) ||
      (row.economic_model && row.economic_model !== 'public') ||
      hasMultipleSectors(row.sector_list);

    if (hasError) return 'spe-row-error';

    const hasTD = selectedYear && hasTeledeclaration(row, selectedYear);
    if (hasTD) return 'spe-row-success';
    if (selectedYear) return 'spe-row-warning';

    return '';
  }, [selectedYear]);

  // Fonction de priorité de tri (erreurs en premier, puis sans TD, puis OK)
  const getRowSortPriority = useCallback((row) => {
    const hasError = !isTrueValue(row.active_on_ma_cantine) ||
      isMissing(row.siret) || isMissing(row.name) ||
      isMissing(row.daily_meal_count) || isMissing(row.production_type) ||
      isMissing(row.management_type) || isMissing(row.economic_model) ||
      (row.economic_model && row.economic_model !== 'public') ||
      hasMultipleSectors(row.sector_list);
    if (hasError) return 1;

    const hasTD = selectedYear && hasTeledeclaration(row, selectedYear);
    if (!hasTD && selectedYear) return 2;

    return 3;
  }, [selectedYear]);

  // Données triées par priorité
  const sortedData = useMemo(() => {
    return [...filteredData].sort((a, b) => getRowSortPriority(a) - getRowSortPriority(b));
  }, [filteredData, getRowSortPriority]);

  // Données affichées (limitées pour les performances)
  const displayedData = useMemo(() => {
    return sortedData.slice(0, displayLimit);
  }, [sortedData, displayLimit]);

  // Export CSV établissements (mémoïsé pour éviter les re-créations)
  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (mode === 'ministere') {
      params.append('line_ministry__exact', selectedMinistere);
    } else {
      params.append('line_ministry__exact', "Préfecture - Administration Territoriale de l'État (ATE)");
      params.append('region_lib__exact', selectedRegion);
    }
    return `https://tabular-api.data.gouv.fr/api/resources/${DATAGOUV_RESOURCE_ID}/data/csv/?${params.toString()}`;
  }, [mode, selectedMinistere, selectedRegion]);

  // Nom du fichier établissements (mémoïsé)
  const exportFilename = useMemo(() => {
    if (mode === 'ministere') {
      return `etablissements_${normalizeFilename(selectedMinistere)}.csv`;
    } else {
      return `etablissements_${normalizeFilename(selectedRegion)}.csv`;
    }
  }, [mode, selectedMinistere, selectedRegion]);

  // Export CSV télédéclarations (mémoïsé)
  const tdExportUrl = useMemo(() => {
    const resourceId = TD_RESOURCES[selectedYear] || TD_RESOURCES['2024'];
    const params = new URLSearchParams();
    if (mode === 'ministere') {
      params.append('canteen_line_ministry__exact', selectedMinistere);
    } else {
      params.append('canteen_line_ministry__exact', "Préfecture - Administration Territoriale de l'État (ATE)");
      params.append('canteen_region_lib__exact', selectedRegion);
    }
    return `https://tabular-api.data.gouv.fr/api/resources/${resourceId}/data/csv/?${params.toString()}`;
  }, [mode, selectedMinistere, selectedRegion, selectedYear]);

  // Nom du fichier TD (mémoïsé)
  const tdExportFilename = useMemo(() => {
    const campagne = parseInt(selectedYear) + 1;
    if (mode === 'ministere') {
      return `teledeclarations_campagne${campagne}_${normalizeFilename(selectedMinistere)}.csv`;
    } else {
      return `teledeclarations_campagne${campagne}_${normalizeFilename(selectedRegion)}.csv`;
    }
  }, [mode, selectedMinistere, selectedRegion, selectedYear]);

  // Fonction de téléchargement
  const handleDownload = async (url, filename, type) => {
    setDownloading(type);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Erreur de téléchargement');
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Erreur téléchargement:', e);
      window.open(url, '_blank');
    } finally {
      setDownloading(null);
    }
  };

  // ==========================================
  // RENDU
  // ==========================================
  return (
    <div className="fr-container fr-py-4w">
      {/* Bandeau info date MAJ */}
      {lastUpdate && (
        <div className="fr-alert fr-alert--info fr-mb-4w">
          <p>
            Données mises à jour le {formatLastUpdate(lastUpdate)} | Source : {' '}
            <a href="https://data.gouv.fr/fr/datasets/registre-national-des-cantines/" target="_blank" rel="noopener noreferrer" title="Registre national des cantines - nouvelle fenêtre">
              Registre national des cantines (data.gouv.fr)
            </a>
          </p>
        </div>
      )}

      {/* Bandeau campagne en cours */}
      <CampaignBanner />

      {/* Sélection du périmètre */}
      <div className="fr-grid-row fr-grid-row--gutters fr-mb-4w">
        <div className="fr-col-12 fr-col-md-4">
          <fieldset className="fr-segmented fr-segmented--sm">
            <legend className="fr-segmented__legend">
              Périmètre d'analyse
            </legend>
            <div className="fr-segmented__elements">
              <div className="fr-segmented__element">
                <input
                  type="radio"
                  id="segmented-mode-ministere"
                  name="segmented-mode"
                  value="ministere"
                  checked={mode === 'ministere'}
                  onChange={() => { setMode('ministere'); setSelectedRegion(''); setSelectedMinistere(''); setData([]); }}
                />
                <label className="fr-label" htmlFor="segmented-mode-ministere">
                  Ministère
                </label>
              </div>
              <div className="fr-segmented__element">
                <input
                  type="radio"
                  id="segmented-mode-region"
                  name="segmented-mode"
                  value="region"
                  checked={mode === 'region'}
                  onChange={() => { setMode('region'); setSelectedMinistere(''); setSelectedRegion(''); setData([]); }}
                />
                <label className="fr-label" htmlFor="segmented-mode-region">
                  ATE Région
                </label>
              </div>
            </div>
          </fieldset>
        </div>

        <div className="fr-col-12 fr-col-md-4">
          {mode === 'ministere' ? (
            <div className="fr-select-group">
              <label className="fr-label" htmlFor="select-ministere">Ministère</label>
              <select
                className="fr-select"
                id="select-ministere"
                value={selectedMinistere}
                onChange={(e) => { setSelectedMinistere(e.target.value); setData([]); }}
              >
                <option value="">Sélectionner un ministère</option>
                {MINISTERES.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="fr-select-group">
              <label className="fr-label" htmlFor="select-region">Région</label>
              <select
                className="fr-select"
                id="select-region"
                value={selectedRegion}
                onChange={(e) => { setSelectedRegion(e.target.value); setData([]); }}
              >
                <option value="">Sélectionner une région</option>
                {REGIONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="fr-col-12 fr-col-md-4">
          <div className="fr-select-group">
            <label className="fr-label" htmlFor="select-year">Campagne de télédéclaration</label>
            <select
              className="fr-select"
              id="select-year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              {availableYears.map(y => (
                <option key={y} value={y}>Campagne {parseInt(y) + 1} (données {y})</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Filtre par secteur */}
      {data.length > 0 && availableSecteurs.length > 1 && (
        <div className="fr-grid-row fr-mb-4w">
          <div className="fr-col-12 fr-col-md-6">
            <div className="fr-select-group">
              <label className="fr-label" htmlFor="select-secteur">Filtre par secteur</label>
              <select
                className="fr-select"
                id="select-secteur"
                value={selectedSecteurs.length === 1 ? selectedSecteurs[0] : ''}
                onChange={(e) => setSelectedSecteurs(e.target.value ? [e.target.value] : [])}
              >
                <option value="">Tous les secteurs ({availableSecteurs.length})</option>
                {availableSecteurs.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Chargement */}
      {loading && (
        <div className="fr-callout fr-mb-4w" role="status" aria-live="polite">
          <p className="fr-callout__text">
            <span className="spe-spinner fr-mr-2w" aria-hidden="true"></span>
            Chargement en cours : {loadingProgress}
          </p>
        </div>
      )}

      {/* Erreur */}
      {error && (
        <div className="fr-alert fr-alert--error fr-mb-4w" role="alert">
          <p className="fr-alert__title">Erreur</p>
          <p>{error}</p>
        </div>
      )}

      {/* Contenu principal */}
      {!loading && !error && data.length > 0 && (
        <>
          {/* KPIs principaux */}
          <div className="fr-grid-row fr-grid-row--gutters fr-mb-4w">
            <div className="fr-col-12 fr-col-md-6">
              <div className="spe-stat-item spe-stat-item--main spe-stat-item--accent">
                <p className="spe-stat-label" style={{ color: 'var(--text-inverted-grey)' }}>
                  Établissements rattachés au périmètre
                </p>
                <p className="spe-stat-value" style={{ color: 'var(--text-inverted-grey)' }}>
                  {formatNumber(stats.totalApi)}
                </p>
              </div>
            </div>
            <div className="fr-col-12 fr-col-md-6">
              <div className="spe-stat-item spe-stat-item--main spe-stat-item--raised">
                <p className="spe-stat-label">
                  Taux de télédéclaration {selectedYear}
                </p>
                <p className={`spe-stat-value ${parseFloat(stats.td[selectedYear]?.pct || 0) >= 100 ? 'spe-stat-value--success' : 'spe-stat-value--warning'}`}>
                  {stats.td[selectedYear] ? formatPct(stats.td[selectedYear].pct) : '0 %'}
                </p>
                <p className="spe-stat-detail">
                  ({stats.td[selectedYear]?.count || 0} / {stats.totalFiltered} établissements)
                </p>
              </div>
            </div>
          </div>

          {/* KPI RIA pour ATE */}
          {mode === 'region' && riaStats && riaStats.cible > 0 && (
            <div className="fr-alert fr-alert--warning fr-mb-4w">
              <p className="fr-alert__title">RIA recensés par la DGAFP (cible au 1er novembre 2025)</p>
              <p className="fr-text--lg fr-text--bold fr-text--center fr-mt-2w">
                <span className={riaStats.count >= riaStats.cible ? 'spe-stat-value--success' : 'spe-stat-value--warning'}>
                  {riaStats.count}
                </span>
                {' / '}
                {riaStats.cible}
                {' | '}
                <span className={riaStats.count >= riaStats.cible ? 'spe-stat-value--success' : 'spe-stat-value--warning'}>
                  {formatPct(riaStats.pct)}
                </span>
              </p>
            </div>
          )}

          {/* KPIs secondaires */}
          <div className="fr-grid-row fr-grid-row--gutters fr-mb-4w">
            <div className="fr-col-6 fr-col-md-4">
              <div className="spe-stat-item spe-stat-item--alt">
                <p className="spe-stat-label">Comptes actifs</p>
                <p className={`spe-stat-value ${parseFloat(stats.actifs.pct) >= 100 ? 'spe-stat-value--success' : 'spe-stat-value--warning'}`}>
                  {formatPct(stats.actifs.pct)}
                </p>
                <p className="spe-stat-detail">({stats.actifs.count} / {stats.totalFiltered})</p>
              </div>
            </div>
            <div className="fr-col-6 fr-col-md-4">
              <div className="spe-stat-item spe-stat-item--alt">
                <p className="spe-stat-label">Moy. couverts/jour</p>
                <p className="spe-stat-value">{formatNumber(mealStats.avgDaily)}</p>
              </div>
            </div>
            <div className="fr-col-12 fr-col-md-4">
              <div className="spe-stat-item spe-stat-item--alt">
                <p className="spe-stat-label">Moy. couverts/an</p>
                <p className="spe-stat-value">{formatNumber(mealStats.avgYearly)}</p>
              </div>
            </div>
          </div>

          {/* Graphiques */}
          <div className="fr-grid-row fr-grid-row--gutters fr-mb-4w">
            {managementStats.length > 0 && (
              <div className="fr-col-12 fr-col-md-6">
                <PieChart data={managementStats} title="Répartition par type de gestion" />
              </div>
            )}
            {mode === 'ministere' && regionStats.length > 0 && (
              <div className="fr-col-12 fr-col-md-6">
                <PieChart data={regionStats} title="Répartition par région" />
              </div>
            )}
          </div>

          {/* Carte des établissements */}
          <EstablishmentsMap
            data={filteredData}
            title="Localisation des établissements"
          />

          {/* Statistiques agrégées EGalim */}
          {isTDDataAvailable && egalimStats.totalWithData > 0 && (
            <div className="fr-grid-row fr-grid-row--gutters fr-mb-4w" style={{ alignItems: 'stretch' }}>
              <div className="fr-col-12 fr-col-md-6" style={{ display: 'flex' }}>
                <div className="fr-callout" style={{ flex: 1, marginBottom: 0 }}>
                  <p className="fr-callout__title">Statistiques agrégées EGalim ({selectedYear})</p>
                  <div className="fr-callout__text">
                    <p className="fr-mb-2w">
                      <span style={{ color: Number(egalimStats.bio.pct) === 100 ? 'var(--text-default-success)' : 'var(--text-default-error)', fontWeight: 700 }}>
                        {egalimStats.bio.pct} % ({egalimStats.bio.count})
                      </span>
                      {' '}des établissements atteignent l'objectif d'approvisionnement en produits bio ({EGALIM_OBJECTIVES.bio} %)
                    </p>
                    <p className="fr-mb-0">
                      <span style={{ color: Number(egalimStats.durable.pct) === 100 ? 'var(--text-default-success)' : 'var(--text-default-error)', fontWeight: 700 }}>
                        {egalimStats.durable.pct} % ({egalimStats.durable.count})
                      </span>
                      {' '}des établissements atteignent l'objectif d'approvisionnement en produits durables et de qualité, dont bio ({EGALIM_OBJECTIVES.durable} %)
                    </p>
                    <p className="fr-text--xs fr-mt-2w fr-mb-0" style={{ color: 'var(--text-mention-grey)' }}>
                      Basé sur {egalimStats.totalWithData} établissements ayant télédéclaré
                    </p>
                  </div>
                </div>
              </div>

              <div className="fr-col-12 fr-col-md-6" style={{ display: 'flex' }}>
                <div className="fr-callout" style={{ flex: 1, marginBottom: 0 }}>
                  <p className="fr-callout__title">Évolution des télédéclarations</p>
                  <div className="fr-callout__text">
                    <ul className="fr-mb-0" style={{ listStyle: 'none', paddingLeft: 0 }}>
                      {tdHistory.map(({ year, count }) => (
                        <li key={year} className="fr-mb-1v" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className={year === selectedYear ? 'fr-text--bold' : ''}>
                            {year === selectedYear ? `${year} (année sélectionnée)` : year}
                          </span>
                          <span className={`fr-badge ${year === selectedYear ? 'fr-badge--blue-france' : 'fr-badge--grey'}`}>
                            {count} télédéclaration{count > 1 ? 's' : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Légende et Qualité des données */}
          <div className="fr-grid-row fr-grid-row--gutters fr-mb-4w" style={{ alignItems: 'stretch' }}>
            <div className="fr-col-12 fr-col-md-6" style={{ display: 'flex' }}>
              <div className="fr-callout fr-callout--green-tilleul-verveine" style={{ flex: 1, marginBottom: 0 }}>
                <p className="fr-callout__title">Légende du tableau</p>
                <div className="fr-callout__text">
                  <p className="fr-mb-1w"><strong>Icônes utilisées :</strong></p>
                  <ul className="fr-mb-0" style={{ listStyle: 'none', paddingLeft: 0 }}>
                    <li className="fr-mb-1v">
                      <span className="fr-icon-warning-fill fr-icon--sm" style={{ color: 'var(--text-default-error)' }} aria-hidden="true"></span>
                      {' '}Information à corriger
                    </li>
                    <li className="fr-mb-1v">
                      <span className="fr-icon-close-circle-fill fr-icon--sm" style={{ color: 'var(--text-default-error)' }} aria-hidden="true"></span>
                      {' '}Télédéclaration à effectuer
                    </li>
                    <li className="fr-mb-1v">
                      <span className="fr-icon-checkbox-circle-fill fr-icon--sm" style={{ color: 'var(--text-default-success)' }} aria-hidden="true"></span>
                      {' '}Télédéclaration effectuée
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="fr-col-12 fr-col-md-6" style={{ display: 'flex' }}>
              <div className="fr-callout" style={{ flex: 1, marginBottom: 0 }}>
                <p className="fr-callout__title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  Qualité des données
                  <span
                    className={`fr-badge ${
                      errorStats.qualityScore <= 10 ? 'fr-badge--success' :
                      errorStats.qualityScore <= 30 ? 'fr-badge--warning' :
                      'fr-badge--error'
                    }`}
                  >
                    {errorStats.qualityScore}% avec erreurs
                  </span>
                </p>
                <div className="fr-callout__text">
                  {errorStats.total > 0 ? (
                    <>
                      <p className="fr-mb-1w">
                        {errorStats.total === 1
                          ? '1 établissement avec information à corriger'
                          : `${errorStats.total} établissements avec informations à corriger`}
                      </p>
                      <ul className="fr-text--sm fr-mb-0">
                        {errorStats.errors.siret > 0 && <li><strong>SIRET manquant</strong> : {errorStats.errors.siret}</li>}
                        {errorStats.errors.no_active_manager > 0 && <li><strong>Gestionnaire non actif</strong> : {errorStats.errors.no_active_manager}</li>}
                        {errorStats.errors.name > 0 && <li>Nom manquant : {errorStats.errors.name}</li>}
                        {errorStats.errors.daily_meal_count > 0 && <li>Couverts/jour manquant : {errorStats.errors.daily_meal_count}</li>}
                        {errorStats.errors.production_type > 0 && <li>Type de production manquant : {errorStats.errors.production_type}</li>}
                        {errorStats.errors.management_type > 0 && <li>Type de gestion manquant : {errorStats.errors.management_type}</li>}
                        {errorStats.errors.economic_model > 0 && <li>Modèle économique manquant : {errorStats.errors.economic_model}</li>}
                        {errorStats.errors.economic_model_private > 0 && <li>Modèle économique non public : {errorStats.errors.economic_model_private}</li>}
                        {errorStats.errors.multiple_sectors > 0 && <li>Plusieurs secteurs renseignés : {errorStats.errors.multiple_sectors}</li>}
                      </ul>
                    </>
                  ) : (
                    <p className="fr-mb-0" style={{ color: 'var(--text-default-success)' }}>
                      <span className="fr-icon-checkbox-circle-fill fr-icon--sm fr-mr-1v" aria-hidden="true"></span>
                      Aucune erreur détectée sur les informations des établissements.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Tableau des établissements */}
          <div className="fr-mb-4w">
            <div className="fr-grid-row fr-grid-row--middle fr-mb-2w">
              <div className="fr-col">
                <p className="fr-text--bold fr-mb-0">
                  Établissements ({filteredData.length})
                  {loadingTD && <span className="fr-ml-2w"><span className="spe-spinner" style={{ width: '1rem', height: '1rem' }}></span> Chargement des télédéclarations...</span>}
                </p>
              </div>
              <div className="fr-col-12 fr-col-md-auto">
                <div className="fr-search-bar" id="search-etablissements" role="search">
                  <label className="fr-label" htmlFor="search-table">
                    Rechercher un établissement
                  </label>
                  <input
                    className="fr-input"
                    placeholder="Nom, SIRET ou ville..."
                    type="search"
                    id="search-table"
                    name="search-table"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <button className="fr-btn" type="button" title="Rechercher" onClick={() => {}}>
                    Rechercher
                  </button>
                </div>
              </div>
            </div>

            {/* Téléchargements */}
            <div className="fr-mb-2w">
              <div className="fr-grid-row fr-grid-row--gutters fr-grid-row--middle">
                <div className="fr-col-auto">
                  <button
                    className="fr-btn fr-btn--secondary fr-btn--sm fr-btn--icon-left fr-icon-download-line"
                    onClick={() => handleDownload(exportUrl, exportFilename, 'etablissements')}
                    disabled={downloading !== null}
                  >
                    {downloading === 'etablissements' ? 'Téléchargement...' : 'Télécharger les établissements (CSV)'}
                  </button>
                </div>
                {selectedYear && isTDDataAvailable && (
                  <div className="fr-col-auto">
                    <button
                      className="fr-btn fr-btn--secondary fr-btn--sm fr-btn--icon-left fr-icon-download-line"
                      onClick={() => handleDownload(tdExportUrl, tdExportFilename, 'teledeclarations')}
                      disabled={downloading !== null}
                    >
                      {downloading === 'teledeclarations' ? 'Téléchargement...' : 'Télécharger les télédéclarations (CSV)'}
                    </button>
                  </div>
                )}
                <div className="fr-col-auto">
                  <a href="https://ma-cantine.crisp.help/fr/article/comment-importer-un-fichier-csv-dans-excel-7zyxo/#1-ouvrir-un-fichier-csv-sur-excel" target="_blank" rel="noopener noreferrer" title="Comment importer un CSV dans Excel - nouvelle fenêtre" className="fr-link fr-text--xs">
                    Comment importer un CSV dans Excel ?
                  </a>
                </div>
              </div>
            </div>

            <div className="fr-table fr-table--bordered">
              <div className="fr-table__wrapper">
                <div className="fr-table__container">
                  <div className="fr-table__content">
                    <table>
                <thead>
                  <tr>
                    <th scope="col" style={{ minWidth: '200px', width: '200px' }}>Nom</th>
                    <th scope="col" style={{ minWidth: '140px', width: '140px' }}>SIRET</th>
                    <th scope="col" style={{ minWidth: '120px', width: '120px' }}>Ville</th>
                    <th scope="col" style={{ minWidth: '130px', width: '130px' }}>Département</th>
                    <th scope="col" style={{ minWidth: '150px', width: '150px' }}>Secteur</th>
                    <th scope="col" style={{ minWidth: '120px', width: '120px' }}>Type gestion</th>
                    <th scope="col" style={{ minWidth: '100px', width: '100px' }}>Modèle éco.</th>
                    <th scope="col" style={{ minWidth: '70px', width: '70px', textAlign: 'center' }}>Actif</th>
                    {availableYears.map(y => (
                      <th key={y} scope="col" style={{ minWidth: '60px', width: '60px', textAlign: 'center' }}>{y}</th>
                    ))}
                    {isTDDataAvailable && (
                      <>
                        <th scope="col" style={{ minWidth: '100px', width: '100px', textAlign: 'center' }} title={`% achats Bio (données ${selectedYear})`}>% Bio ({selectedYear})</th>
                        <th scope="col" style={{ minWidth: '160px', width: '160px', textAlign: 'center' }} title={`% achats EGalim hors bio (données ${selectedYear})`}>% Qualité hors bio ({selectedYear})</th>
                        <th scope="col" style={{ minWidth: '140px', width: '140px', textAlign: 'center' }} title={`% total EGalim incluant bio (données ${selectedYear})`}>% EGalim total ({selectedYear})</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {displayedData.map((row, i) => (
                    <tr key={row.id || i} className={getRowClassName(row)}>
                      <td className="spe-word-break" style={{ minWidth: '200px', width: '200px' }}>
                        {isMissing(row.name) ? <span className="spe-text-error"><span className="fr-icon-warning-fill fr-icon--sm" aria-hidden="true"></span> -</span> : row.name}
                      </td>
                      <td className="spe-text-mono" style={{ minWidth: '140px', width: '140px' }}>
                        {isMissing(row.siret) ? <span className="spe-text-error"><span className="fr-icon-warning-fill fr-icon--sm" aria-hidden="true"></span> -</span> : row.siret}
                      </td>
                      <td style={{ minWidth: '120px', width: '120px' }}>{row.city || '-'}</td>
                      <td style={{ minWidth: '130px', width: '130px' }}>{row.department_lib || '-'}</td>
                      <td className="spe-word-break" style={{ minWidth: '150px', width: '150px' }}>
                        {hasMultipleSectors(row.sector_list) ? (
                          <span className="spe-text-error"><span className="fr-icon-warning-fill fr-icon--sm" aria-hidden="true"></span> {row.sector_list}</span>
                        ) : (
                          row.sector_list || '-'
                        )}
                      </td>
                      <td style={{ minWidth: '120px', width: '120px' }}>
                        {isMissing(row.management_type) ? (
                          <span className="spe-text-error"><span className="fr-icon-warning-fill fr-icon--sm" aria-hidden="true"></span> -</span>
                        ) : (
                          translateManagementType(row.management_type)
                        )}
                      </td>
                      <td style={{ minWidth: '100px', width: '100px' }}>
                        {isMissing(row.economic_model) ? (
                          <span className="spe-text-error"><span className="fr-icon-warning-fill fr-icon--sm" aria-hidden="true"></span> -</span>
                        ) : row.economic_model !== 'public' ? (
                          <span className="spe-text-error"><span className="fr-icon-warning-fill fr-icon--sm" aria-hidden="true"></span> {row.economic_model === 'private' ? 'privé' : row.economic_model}</span>
                        ) : (
                          <span style={{ color: 'var(--text-default-success)' }}>public</span>
                        )}
                      </td>
                      <td style={{ minWidth: '70px', width: '70px', textAlign: 'center' }}>
                        {isTrueValue(row.active_on_ma_cantine) ? (
                          <span style={{ color: 'var(--text-default-success)' }}>oui</span>
                        ) : (
                          <span className="spe-text-error"><span className="fr-icon-warning-fill fr-icon--sm" aria-hidden="true"></span> non</span>
                        )}
                      </td>
                      {availableYears.map(y => (
                        <td key={y} style={{ minWidth: '60px', width: '60px', textAlign: 'center' }}>
                          {hasTeledeclaration(row, y) ? (
                            <span className="fr-icon-checkbox-circle-fill fr-icon--sm" style={{ color: 'var(--text-default-success)' }} aria-label="Oui"></span>
                          ) : (
                            <span className="fr-icon-close-circle-fill fr-icon--sm" style={{ color: 'var(--text-default-error)' }} aria-label="Non"></span>
                          )}
                        </td>
                      ))}
                      {isTDDataAvailable && (
                        <>
                          <td style={{ minWidth: '100px', width: '100px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {(() => {
                              const td = teledeclarations[row.siret]?.[selectedYear];
                              if (!td || td.ratio_bio === null || td.ratio_bio === undefined) return '-';
                              const pctValue = Number(td.ratio_bio) * 100;
                              const color = pctValue >= 20 ? 'var(--text-default-success)' :
                                            pctValue >= 10 ? 'var(--text-default-warning)' :
                                            'var(--text-default-error)';
                              return <span style={{ color }}>{formatPct(pctValue)}</span>;
                            })()}
                          </td>
                          <td style={{ minWidth: '160px', width: '160px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {(() => {
                              const td = teledeclarations[row.siret]?.[selectedYear];
                              if (!td || td.ratio_egalim === null || td.ratio_egalim === undefined) return '-';
                              const pctValue = Number(td.ratio_egalim) * 100;
                              return <span>{formatPct(pctValue)}</span>;
                            })()}
                          </td>
                          <td style={{ minWidth: '140px', width: '140px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {(() => {
                              const td = teledeclarations[row.siret]?.[selectedYear];
                              if (!td) return '-';
                              const bio = td.ratio_bio ? Number(td.ratio_bio) * 100 : 0;
                              const egalim = td.ratio_egalim ? Number(td.ratio_egalim) * 100 : 0;
                              if (td.ratio_bio === null && td.ratio_egalim === null) return '-';
                              const total = bio + egalim;
                              const color = total >= 50 ? 'var(--text-default-success)' :
                                            total >= 25 ? 'var(--text-default-warning)' :
                                            'var(--text-default-error)';
                              return <span style={{ color }}>{formatPct(total)}</span>;
                            })()}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Bouton Afficher plus */}
            {sortedData.length > displayLimit && (
              <div className="fr-mt-2w" style={{ textAlign: 'center' }}>
                <button
                  className="fr-btn fr-btn--secondary"
                  onClick={() => setDisplayLimit(prev => prev + 100)}
                >
                  Afficher plus ({displayLimit} / {sortedData.length} établissements)
                </button>
                <button
                  className="fr-btn fr-btn--tertiary-no-outline fr-ml-2w"
                  onClick={() => setDisplayLimit(sortedData.length)}
                >
                  Tout afficher
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* État vide */}
      {!loading && !error && data.length === 0 && (selectedMinistere || selectedRegion) && (
        <div className="fr-callout">
          <p className="fr-callout__text">
            Aucun établissement trouvé pour ce périmètre.
          </p>
        </div>
      )}

      {/* Invitation à sélectionner */}
      {!loading && !error && !selectedMinistere && !selectedRegion && (
        <div className="fr-callout">
          <p className="fr-callout__text">
            Sélectionnez un ministère ou une région pour afficher les données.
          </p>
        </div>
      )}
    </div>
  );
}
