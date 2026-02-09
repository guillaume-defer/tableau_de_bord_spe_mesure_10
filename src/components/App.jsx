import { useState, useEffect, useMemo, useCallback } from 'react';
import { PieChart } from './PieChart';
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
  INITIAL_DISPLAY_LIMIT
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
  classifyEstablishment,
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
  const [speClassification, setSpeClassification] = useState({});
  const [checkingSirets, setCheckingSirets] = useState(false);
  const [checkingProgress, setCheckingProgress] = useState('');
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
  // VÉRIFICATION SIRET VIA API RECHERCHE ENTREPRISES
  // ==========================================
  const checkSpeClassification = async (rows) => {
    if (!rows || rows.length === 0) return;

    setCheckingSirets(true);
    const classifications = {};
    const uniqueSirets = [...new Set(rows.map(r => r.siret).filter(s => s))];

    for (let i = 0; i < uniqueSirets.length; i++) {
      const siret = uniqueSirets[i];
      setCheckingProgress(`${i + 1}/${uniqueSirets.length}`);

      try {
        // Utilisation de l'API Recherche Entreprises (api.gouv.fr) - gratuite, sans auth
        const response = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${siret}&mtm_campaign=spe-dashboard`);

        if (response.ok) {
          const data = await response.json();
          const entreprise = data.results?.[0];
          const row = rows.find(r => r.siret === siret);

          if (entreprise) {
            classifications[siret] = classifyEstablishment(row, {
              categorie_juridique: entreprise.nature_juridique
            });
          } else {
            classifications[siret] = classifyEstablishment(row, null);
          }
        } else {
          const row = rows.find(r => r.siret === siret);
          classifications[siret] = classifyEstablishment(row, null);
        }
      } catch (err) {
        console.warn('Erreur vérification SIRET:', siret, err);
        const row = rows.find(r => r.siret === siret);
        classifications[siret] = classifyEstablishment(row, null);
      }

      // Mise à jour progressive toutes les 10 vérifications
      if (i % 10 === 0) {
        setSpeClassification(prev => ({ ...prev, ...classifications }));
      }
    }

    setSpeClassification(prev => ({ ...prev, ...classifications }));
    setCheckingSirets(false);
    setCheckingProgress('');
  };

  // ==========================================
  // CHARGEMENT DES DONNÉES
  // ==========================================

  // Date de mise à jour
  useEffect(() => {
    const fetchLastUpdate = async () => {
      try {
        const tabularResponse = await fetch(`https://tabular-api.data.gouv.fr/api/resources/${DATAGOUV_RESOURCE_ID}/`);
        if (tabularResponse.ok) {
          const tabularData = await tabularResponse.json();
          if (tabularData.created_at) {
            setLastUpdate(tabularData.created_at);
            return;
          }
        }

        const response = await fetch(`https://www.data.gouv.fr/api/1/datasets/${DATAGOUV_DATASET_ID}/`);
        if (response.ok) {
          const data = await response.json();
          const resource = data.resources?.find(r => r.id === DATAGOUV_RESOURCE_ID);
          if (resource?.last_modified) {
            setLastUpdate(resource.last_modified);
          } else if (data.last_update) {
            setLastUpdate(data.last_update);
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
      setSpeClassification({});
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
        checkSpeClassification(allData);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
        setLoadingProgress('');
      }
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Classification SPE d'une ligne
  const getSpeClass = useCallback((row) => {
    const siret = row.siret ? row.siret.toString().trim() : '';
    return speClassification[siret] || null;
  }, [speClassification]);

  const getSpeBadge = useCallback((row) => {
    const speClass = getSpeClass(row);
    if (speClass === 'BLANC') return {
      text: 'Établissement SPE',
      icon: 'fr-icon-checkbox-circle-fill',
      color: 'var(--text-default-success)'
    };
    if (speClass === 'NOIR') return {
      text: 'Hors périmètre SPE',
      icon: 'fr-icon-close-circle-fill',
      color: 'var(--text-mention-grey)'
    };
    if (speClass === 'ORANGE') return {
      text: 'Classification à vérifier',
      icon: 'fr-icon-question-fill',
      color: 'var(--text-default-warning)'
    };
    return null;
  }, [getSpeClass]);

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

  // Stats erreurs
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

    return { errors, total };
  }, [filteredData]);

  // Stats SPE
  const speStats = useMemo(() => {
    const stats = { BLANC: 0, NOIR: 0, ORANGE: 0, INCONNU: 0 };
    filteredData.forEach(row => {
      const siret = row.siret ? row.siret.toString().trim() : '';
      const classification = speClassification[siret];
      if (classification) stats[classification]++;
      else stats.INCONNU++;
    });
    return stats;
  }, [filteredData, speClassification]);

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

  // Vérifier si les données de télédéclaration détaillées sont disponibles pour l'année sélectionnée
  // Les données détaillées (Bio, Qualité, etc.) viennent des ressources TD_RESOURCES
  // qui peuvent ne pas exister encore pour les années récentes (ex: 2025)
  const isTDDataAvailable = useMemo(() => {
    return TD_RESOURCES.hasOwnProperty(selectedYear);
  }, [selectedYear]);

  // Style de ligne tableau
  const getRowClassName = useCallback((row) => {
    const speClass = getSpeClass(row);
    if (speClass === 'NOIR') return 'spe-row-excluded';

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
  }, [getSpeClass, selectedYear]);

  // Fonction de priorité de tri
  const getRowSortPriority = useCallback((row) => {
    const speClass = getSpeClass(row);
    if (speClass === 'NOIR') return 1;
    if (speClass === 'ORANGE') return 2;

    const hasError = !isTrueValue(row.active_on_ma_cantine) ||
      isMissing(row.siret) || isMissing(row.name) ||
      isMissing(row.daily_meal_count) || isMissing(row.production_type) ||
      isMissing(row.management_type) || isMissing(row.economic_model) ||
      (row.economic_model && row.economic_model !== 'public') ||
      hasMultipleSectors(row.sector_list);
    if (hasError) return 3;

    const hasTD = selectedYear && hasTeledeclaration(row, selectedYear);
    if (!hasTD && selectedYear) return 4;

    return 5;
  }, [getSpeClass, selectedYear]);

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
            <a href="https://data.gouv.fr/fr/datasets/registre-national-des-cantines/" target="_blank" rel="noopener" title="Registre national des cantines - nouvelle fenêtre">
              Registre national des cantines (data.gouv.fr)
            </a>
          </p>
        </div>
      )}

      {/* Sélection du périmètre */}
      <div className="fr-grid-row fr-grid-row--gutters fr-mb-4w">
        <div className="fr-col-12 fr-col-md-4">
          <fieldset className="fr-fieldset">
            <legend className="fr-fieldset__legend fr-text--bold">Périmètre d'analyse</legend>
            <div className="fr-fieldset__content">
              <div className="fr-btns-group fr-btns-group--inline-sm">
                <button
                  type="button"
                  className={mode === 'ministere' ? 'fr-btn' : 'fr-btn fr-btn--secondary'}
                  onClick={() => { setMode('ministere'); setSelectedRegion(''); setSelectedMinistere(''); setData([]); }}
                  aria-pressed={mode === 'ministere'}
                >
                  Ministère
                </button>
                <button
                  type="button"
                  className={mode === 'region' ? 'fr-btn' : 'fr-btn fr-btn--secondary'}
                  onClick={() => { setMode('region'); setSelectedMinistere(''); setSelectedRegion(''); setData([]); }}
                  aria-pressed={mode === 'region'}
                >
                  ATE Région
                </button>
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

          {/* Légende et Classification SPE */}
          <div className="fr-grid-row fr-grid-row--gutters fr-mb-4w" style={{ alignItems: 'stretch' }}>
            <div className="fr-col-12 fr-col-md-6" style={{ display: 'flex' }}>
              <div className="fr-callout fr-callout--brown-caramel" style={{ flex: 1, marginBottom: 0 }}>
                <p className="fr-callout__title">Légende</p>
                <div className="fr-callout__text">
                  <p className="fr-mb-1w"><strong>Couleurs des lignes :</strong></p>
                  <ul className="fr-mb-2w">
                    <li><span className="spe-legend-color spe-legend-color--error">Rouge</span> : Information à corriger</li>
                    <li><span className="spe-legend-color spe-legend-color--warning">Jaune</span> : Télédéclaration à effectuer</li>
                    <li><span className="spe-legend-color spe-legend-color--success">Vert</span> : Télédéclaration effectuée</li>
                  </ul>
                  <p className="fr-mb-1w"><strong>Colonne SPE :</strong></p>
                  <ul>
                    <li><span className="fr-icon-checkbox-circle-fill fr-icon--sm fr-mr-1v" style={{ color: 'var(--text-default-success)' }} aria-hidden="true"></span> Établissement SPE</li>
                    <li><span className="fr-icon-close-circle-fill fr-icon--sm fr-mr-1v" style={{ color: 'var(--text-mention-grey)' }} aria-hidden="true"></span> Hors périmètre SPE</li>
                    <li><span className="fr-icon-question-fill fr-icon--sm fr-mr-1v" style={{ color: 'var(--text-default-warning)' }} aria-hidden="true"></span> À vérifier</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="fr-col-12 fr-col-md-6" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="fr-callout" style={{ flex: 1, marginBottom: 0 }}>
                <p className="fr-callout__title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Classification SPE
                </p>
                <div className="fr-callout__text">
                  <div className="fr-grid-row fr-grid-row--gutters">
                    <div className="fr-col-4" style={{ textAlign: 'center' }}>
                      <p className="spe-stat-label">SPE</p>
                      <p className="spe-stat-value spe-stat-value--success">
                        <span className="fr-icon-checkbox-circle-fill fr-icon--sm fr-mr-1v" aria-hidden="true"></span>{speStats.BLANC}
                      </p>
                    </div>
                    <div className="fr-col-4" style={{ textAlign: 'center' }}>
                      <p className="spe-stat-label">Hors SPE</p>
                      <p className="spe-stat-value">
                        <span className="fr-icon-close-circle-fill fr-icon--sm fr-mr-1v" aria-hidden="true"></span>{speStats.NOIR}
                      </p>
                    </div>
                    <div className="fr-col-4" style={{ textAlign: 'center' }}>
                      <p className="spe-stat-label">À vérifier</p>
                      <p className="spe-stat-value spe-stat-value--warning">
                        <span className="fr-icon-question-fill fr-icon--sm fr-mr-1v" aria-hidden="true"></span>{speStats.ORANGE}
                      </p>
                    </div>
                  </div>
                  {checkingSirets && (
                    <p className="spe-stat-detail fr-mt-2w">Vérification en cours ({checkingProgress})</p>
                  )}
                </div>
              </div>

              {errorStats.total > 0 ? (
                <div className="fr-alert fr-alert--error" style={{ flex: 1, marginBottom: 0 }}>
                  <p className="fr-alert__title">
                    {errorStats.total === 1
                      ? '1 établissement avec information à corriger'
                      : `${errorStats.total} établissements avec informations à corriger`}
                  </p>
                  <ul className="fr-mt-2w">
                    {errorStats.errors.no_active_manager > 0 && <li>Gestionnaire non actif : {errorStats.errors.no_active_manager}</li>}
                    {errorStats.errors.siret > 0 && <li>SIRET manquant : {errorStats.errors.siret}</li>}
                    {errorStats.errors.name > 0 && <li>Nom manquant : {errorStats.errors.name}</li>}
                    {errorStats.errors.daily_meal_count > 0 && <li>Couverts/jour manquant : {errorStats.errors.daily_meal_count}</li>}
                    {errorStats.errors.production_type > 0 && <li>Type de production manquant : {errorStats.errors.production_type}</li>}
                    {errorStats.errors.management_type > 0 && <li>Type de gestion manquant : {errorStats.errors.management_type}</li>}
                    {errorStats.errors.economic_model > 0 && <li>Modèle économique manquant : {errorStats.errors.economic_model}</li>}
                    {errorStats.errors.economic_model_private > 0 && <li>Modèle économique non public : {errorStats.errors.economic_model_private}</li>}
                    {errorStats.errors.multiple_sectors > 0 && <li>Plusieurs secteurs renseignés : {errorStats.errors.multiple_sectors}</li>}
                  </ul>
                </div>
              ) : (
                <div className="fr-alert fr-alert--success" style={{ flex: 1, marginBottom: 0 }}>
                  <p>Aucune erreur détectée sur les informations des établissements.</p>
                </div>
              )}
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
              <div className="fr-col-auto">
                <div className="fr-search-bar" role="search">
                  <label className="fr-label fr-sr-only" htmlFor="search-table">Rechercher</label>
                  <input
                    className="fr-input"
                    placeholder="Rechercher..."
                    type="search"
                    id="search-table"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
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
                  <a href="https://ma-cantine.crisp.help/fr/article/comment-importer-un-fichier-csv-dans-excel-7zyxo/#1-ouvrir-un-fichier-csv-sur-excel" target="_blank" rel="noopener" title="Comment importer un CSV dans Excel - nouvelle fenêtre" className="fr-link fr-text--xs">
                    Comment importer un CSV dans Excel ?
                  </a>
                </div>
              </div>
            </div>

            <div className="fr-table fr-table--bordered" style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">SPE</th>
                    <th scope="col">Nom</th>
                    <th scope="col">SIRET</th>
                    <th scope="col">Ville</th>
                    <th scope="col">Département</th>
                    <th scope="col">Secteur</th>
                    <th scope="col">Type gestion</th>
                    <th scope="col">Modèle éco.</th>
                    <th scope="col" style={{ textAlign: 'center' }}>Actif</th>
                    {availableYears.map(y => (
                      <th key={y} scope="col" style={{ textAlign: 'center' }}>{y}</th>
                    ))}
                    {isTDDataAvailable && (
                      <>
                        <th scope="col" style={{ textAlign: 'center' }} title={`% achats Bio (données ${selectedYear})`}>% Bio ({selectedYear})</th>
                        <th scope="col" style={{ textAlign: 'center' }} title={`% achats EGalim hors bio (données ${selectedYear})`}>% Qualité hors bio ({selectedYear})</th>
                        <th scope="col" style={{ textAlign: 'center' }} title={`% total EGalim incluant bio (données ${selectedYear})`}>% EGalim total ({selectedYear})</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {displayedData.map((row, i) => (
                    <tr key={row.id || i} className={getRowClassName(row)}>
                      <td style={{ textAlign: 'center' }}>
                        {getSpeBadge(row) ? (
                          <span
                            className={getSpeBadge(row).icon}
                            title={getSpeBadge(row).text}
                            style={{ color: getSpeBadge(row).color }}
                            aria-label={getSpeBadge(row).text}
                          ></span>
                        ) : (
                          <span className="spe-spinner" style={{ width: '1rem', height: '1rem' }}></span>
                        )}
                      </td>
                      <td className="spe-word-break" style={{ maxWidth: '12.5rem' }}>
                        {isMissing(row.name) ? <span className="spe-text-error"><span className="fr-icon-warning-fill fr-icon--sm" aria-hidden="true"></span> -</span> : row.name}
                      </td>
                      <td className="spe-text-mono">
                        {isMissing(row.siret) ? <span className="spe-text-error"><span className="fr-icon-warning-fill fr-icon--sm" aria-hidden="true"></span> -</span> : row.siret}
                      </td>
                      <td>{row.city || '-'}</td>
                      <td>{row.department_lib || '-'}</td>
                      <td className="spe-word-break" style={{ maxWidth: '11.25rem' }}>
                        {hasMultipleSectors(row.sector_list) ? (
                          <span className="spe-text-error"><span className="fr-icon-warning-fill fr-icon--sm" aria-hidden="true"></span> {row.sector_list}</span>
                        ) : (
                          row.sector_list || '-'
                        )}
                      </td>
                      <td>
                        {isMissing(row.management_type) ? (
                          <span className="spe-text-error"><span className="fr-icon-warning-fill fr-icon--sm" aria-hidden="true"></span> -</span>
                        ) : (
                          translateManagementType(row.management_type)
                        )}
                      </td>
                      <td>
                        {isMissing(row.economic_model) ? (
                          <span className="spe-text-error"><span className="fr-icon-warning-fill fr-icon--sm" aria-hidden="true"></span> -</span>
                        ) : row.economic_model !== 'public' ? (
                          <span className="spe-text-error"><span className="fr-icon-warning-fill fr-icon--sm" aria-hidden="true"></span> {row.economic_model === 'private' ? 'privé' : row.economic_model}</span>
                        ) : (
                          <span style={{ color: 'var(--text-default-success)' }}>public</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {isTrueValue(row.active_on_ma_cantine) ? (
                          <span style={{ color: 'var(--text-default-success)' }}>oui</span>
                        ) : (
                          <span className="spe-text-error"><span className="fr-icon-warning-fill fr-icon--sm" aria-hidden="true"></span> non</span>
                        )}
                      </td>
                      {availableYears.map(y => (
                        <td key={y} style={{ textAlign: 'center' }}>
                          {hasTeledeclaration(row, y) ? (
                            <span className="fr-icon-checkbox-circle-fill fr-icon--sm" style={{ color: 'var(--text-default-success)' }} aria-label="Oui"></span>
                          ) : (
                            <span className="fr-icon-close-circle-fill fr-icon--sm" style={{ color: 'var(--text-default-error)' }} aria-label="Non"></span>
                          )}
                        </td>
                      ))}
                      {isTDDataAvailable && (
                        <>
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {(() => {
                              const td = teledeclarations[row.siret]?.[selectedYear];
                              if (!td || td.ratio_bio === null || td.ratio_bio === undefined) return '-';
                              const pctValue = Number(td.ratio_bio) * 100;
                              const isGood = pctValue >= 20;
                              return <span style={{ color: isGood ? 'var(--text-default-success)' : 'var(--text-default-warning)' }}>{formatPct(pctValue)}</span>;
                            })()}
                          </td>
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {(() => {
                              const td = teledeclarations[row.siret]?.[selectedYear];
                              if (!td || td.ratio_egalim === null || td.ratio_egalim === undefined) return '-';
                              const pctValue = Number(td.ratio_egalim) * 100;
                              return <span>{formatPct(pctValue)}</span>;
                            })()}
                          </td>
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {(() => {
                              const td = teledeclarations[row.siret]?.[selectedYear];
                              if (!td) return '-';
                              const bio = td.ratio_bio ? Number(td.ratio_bio) * 100 : 0;
                              const egalim = td.ratio_egalim ? Number(td.ratio_egalim) * 100 : 0;
                              if (td.ratio_bio === null && td.ratio_egalim === null) return '-';
                              const total = bio + egalim;
                              const isGood = total >= 50;
                              return <span style={{ color: isGood ? 'var(--text-default-success)' : 'var(--text-default-warning)' }}>{formatPct(total)}</span>;
                            })()}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
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
