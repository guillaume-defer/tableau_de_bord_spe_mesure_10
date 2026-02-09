import { useState, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in React-Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Cache des coordonnées (persisté en sessionStorage)
const SIRET_CACHE_KEY = 'spe_siret_coords';
const INSEE_CACHE_KEY = 'spe_communes_coords';

const getCacheFromStorage = (key) => {
  try {
    const cached = sessionStorage.getItem(key);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
};

const saveCache = (key, cache) => {
  try {
    // Limiter la taille du cache pour éviter de saturer sessionStorage
    const entries = Object.entries(cache);
    if (entries.length > 5000) {
      const trimmed = Object.fromEntries(entries.slice(-4000));
      sessionStorage.setItem(key, JSON.stringify(trimmed));
    } else {
      sessionStorage.setItem(key, JSON.stringify(cache));
    }
  } catch {
    // Storage full, ignore
  }
};

// Configurations des territoires
const TERRITORIES = {
  metropole: {
    name: 'France métropolitaine',
    center: [46.603354, 1.888334],
    zoom: 5,
    bounds: [[41.0, -5.5], [51.5, 10.0]]
  },
  guadeloupe: {
    name: 'Guadeloupe',
    center: [16.265, -61.551],
    zoom: 9,
    deptCodes: ['971']
  },
  martinique: {
    name: 'Martinique',
    center: [14.636, -61.024],
    zoom: 10,
    deptCodes: ['972']
  },
  guyane: {
    name: 'Guyane',
    center: [3.933, -53.125],
    zoom: 6,
    deptCodes: ['973']
  },
  reunion: {
    name: 'La Réunion',
    center: [-21.115, 55.536],
    zoom: 9,
    deptCodes: ['974']
  },
  mayotte: {
    name: 'Mayotte',
    center: [-12.827, 45.166],
    zoom: 10,
    deptCodes: ['976']
  }
};

// Codes départements outre-mer
const DOM_DEPT_CODES = ['971', '972', '973', '974', '976'];

// Hook pour géocoder les établissements
// Priorité 1: API Recherche Entreprises (précision adresse via SIRET)
// Priorité 2: API Géo (centroïde commune via code INSEE)
const useGeocodedEstablishments = (establishments) => {
  const [geocodedData, setGeocodedData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [stats, setStats] = useState({ siret: 0, insee: 0, failed: 0 });
  const siretCache = useRef(getCacheFromStorage(SIRET_CACHE_KEY));
  const inseeCache = useRef(getCacheFromStorage(INSEE_CACHE_KEY));

  useEffect(() => {
    if (!establishments || establishments.length === 0) {
      setGeocodedData([]);
      return;
    }

    const geocodeAll = async () => {
      setLoading(true);
      const results = [];
      let siretCount = 0;
      let inseeCount = 0;
      let failedCount = 0;

      // Étape 1: Identifier les SIRET à géocoder via API Recherche Entreprises
      const siretsToFetch = [];
      const inseeToFetch = new Set();

      establishments.forEach(est => {
        const siret = est.siret?.toString().trim();
        const insee = est.city_insee_code;

        if (siret && siret.length === 14) {
          if (!siretCache.current[siret]) {
            siretsToFetch.push(siret);
          }
        } else if (insee && !inseeCache.current[insee]) {
          inseeToFetch.add(insee);
        }
      });

      // Étape 2: Géocoder par SIRET via API Recherche Entreprises
      if (siretsToFetch.length > 0) {
        const batchSize = 10; // API plus sensible au rate limiting
        for (let i = 0; i < siretsToFetch.length; i += batchSize) {
          const batch = siretsToFetch.slice(i, i + batchSize);
          setProgress(`Géocodage SIRET ${Math.min(i + batchSize, siretsToFetch.length)}/${siretsToFetch.length}...`);

          await Promise.all(batch.map(async (siret) => {
            try {
              const response = await fetch(
                `https://recherche-entreprises.api.gouv.fr/search?q=${siret}&mtm_campaign=spe-dashboard`
              );
              if (response.ok) {
                const data = await response.json();
                const result = data.results?.[0];
                // Chercher l'établissement correspondant au SIRET (siège ou établissement)
                const siege = result?.siege;
                if (siege?.latitude && siege?.longitude && siege.siret === siret) {
                  siretCache.current[siret] = {
                    coords: [parseFloat(siege.latitude), parseFloat(siege.longitude)],
                    address: siege.geo_adresse || siege.adresse,
                    precision: 'address'
                  };
                } else if (result?.matching_etablissements) {
                  // Chercher dans les établissements correspondants
                  const match = result.matching_etablissements.find(e => e.siret === siret);
                  if (match?.latitude && match?.longitude) {
                    siretCache.current[siret] = {
                      coords: [parseFloat(match.latitude), parseFloat(match.longitude)],
                      address: match.geo_adresse || match.adresse,
                      precision: 'address'
                    };
                  }
                }
              }
            } catch {
              // Ignore errors, will fallback to INSEE
            }
          }));

          // Délai pour éviter le rate limiting
          if (i + batchSize < siretsToFetch.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
        saveCache(SIRET_CACHE_KEY, siretCache.current);
      }

      // Étape 3: Identifier les codes INSEE manquants (SIRET non trouvés + établissements sans SIRET)
      establishments.forEach(est => {
        const siret = est.siret?.toString().trim();
        const insee = est.city_insee_code;

        if (siret && siret.length === 14 && !siretCache.current[siret]) {
          // SIRET non trouvé, fallback sur INSEE
          if (insee && !inseeCache.current[insee]) {
            inseeToFetch.add(insee);
          }
        }
      });

      // Étape 4: Géocoder par code INSEE via API Géo
      const inseeCodesToFetch = Array.from(inseeToFetch);
      if (inseeCodesToFetch.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < inseeCodesToFetch.length; i += batchSize) {
          const batch = inseeCodesToFetch.slice(i, i + batchSize);
          setProgress(`Géocodage communes ${Math.min(i + batchSize, inseeCodesToFetch.length)}/${inseeCodesToFetch.length}...`);

          await Promise.all(batch.map(async (inseeCode) => {
            try {
              const response = await fetch(`https://geo.api.gouv.fr/communes/${inseeCode}?fields=centre,nom`);
              if (response.ok) {
                const data = await response.json();
                if (data.centre?.coordinates) {
                  inseeCache.current[inseeCode] = {
                    coords: [data.centre.coordinates[1], data.centre.coordinates[0]],
                    name: data.nom,
                    precision: 'commune'
                  };
                }
              }
            } catch {
              // Ignore errors
            }
          }));

          if (i + batchSize < inseeCodesToFetch.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        saveCache(INSEE_CACHE_KEY, inseeCache.current);
      }

      // Étape 5: Assembler les résultats
      establishments.forEach(est => {
        const siret = est.siret?.toString().trim();
        const insee = est.city_insee_code;
        let geocoded = null;

        // Priorité 1: Coordonnées SIRET (précision adresse)
        if (siret && siret.length === 14 && siretCache.current[siret]) {
          geocoded = siretCache.current[siret];
          siretCount++;
        }
        // Priorité 2: Coordonnées INSEE (précision commune)
        else if (insee && inseeCache.current[insee]) {
          geocoded = inseeCache.current[insee];
          inseeCount++;
        }

        if (geocoded) {
          results.push({
            ...est,
            coordinates: geocoded.coords,
            geocodeAddress: geocoded.address,
            geocodePrecision: geocoded.precision
          });
        } else {
          failedCount++;
        }
      });

      setStats({ siret: siretCount, insee: inseeCount, failed: failedCount });
      setGeocodedData(results);
      setLoading(false);
      setProgress('');
    };

    geocodeAll();
  }, [establishments]);

  return { geocodedData, loading, progress, stats };
};

// Composant pour ajuster la vue de la carte
const MapBoundsHandler = ({ establishments, territory }) => {
  const map = useMap();

  useEffect(() => {
    if (territory === 'metropole' && establishments.length > 0) {
      const metroEstablishments = establishments.filter(e => {
        const dept = e.department?.toString().padStart(2, '0');
        return dept && !DOM_DEPT_CODES.includes(dept);
      });

      if (metroEstablishments.length > 0) {
        const bounds = L.latLngBounds(metroEstablishments.map(e => e.coordinates));
        map.fitBounds(bounds, { padding: [20, 20], maxZoom: 10 });
      }
    }
  }, [map, establishments, territory]);

  return null;
};

// Icône personnalisée pour les clusters
const createClusterCustomIcon = (cluster) => {
  const count = cluster.getChildCount();
  let className = 'spe-marker-cluster-small';

  if (count >= 100) {
    className = 'spe-marker-cluster-large';
  } else if (count >= 10) {
    className = 'spe-marker-cluster-medium';
  }

  return L.divIcon({
    html: `<div><span>${count}</span></div>`,
    className: `spe-marker-cluster ${className}`,
    iconSize: L.point(40, 40, true),
  });
};

// Carte d'un territoire (métropole ou DOM)
const TerritoryMap = ({ establishments, territory, config, isInset = false }) => {
  const filteredEstablishments = useMemo(() => {
    if (territory === 'metropole') {
      return establishments.filter(e => {
        const dept = e.department?.toString().padStart(2, '0');
        return dept && !DOM_DEPT_CODES.includes(dept);
      });
    }
    return establishments.filter(e => {
      const dept = e.department?.toString().padStart(2, '0');
      return config.deptCodes?.includes(dept);
    });
  }, [establishments, territory, config]);

  if (filteredEstablishments.length === 0) return null;

  const mapStyle = isInset
    ? { height: '120px', width: '100%', borderRadius: '4px', border: '1px solid var(--border-default-grey)' }
    : { height: '400px', width: '100%', borderRadius: '8px' };

  return (
    <div style={isInset ? { marginBottom: '0.5rem' } : {}}>
      {isInset && (
        <p className="fr-text--xs fr-mb-1v" style={{ fontWeight: 'bold' }}>
          {config.name} ({filteredEstablishments.length})
        </p>
      )}
      <MapContainer
        center={config.center}
        zoom={config.zoom}
        style={mapStyle}
        scrollWheelZoom={!isInset}
        dragging={!isInset}
        zoomControl={!isInset}
        attributionControl={!isInset}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={createClusterCustomIcon}
          maxClusterRadius={isInset ? 30 : 50}
          spiderfyOnMaxZoom={!isInset}
          showCoverageOnHover={false}
        >
          {filteredEstablishments.map((est, idx) => (
            <Marker key={est.id || idx} position={est.coordinates}>
              <Popup>
                <div style={{ minWidth: '200px' }}>
                  <strong>{est.name || 'Sans nom'}</strong>
                  <br />
                  <span className="fr-text--xs">{est.city || '-'} ({est.department_lib || '-'})</span>
                  {est.siret && (
                    <>
                      <br />
                      <span className="fr-text--xs">SIRET: {est.siret}</span>
                    </>
                  )}
                  {est.geocodeAddress && (
                    <>
                      <br />
                      <span className="fr-text--xs" style={{ color: 'var(--text-mention-grey)' }}>
                        {est.geocodeAddress}
                      </span>
                    </>
                  )}
                  {est.sector_list && (
                    <>
                      <br />
                      <span className="fr-text--xs">{est.sector_list}</span>
                    </>
                  )}
                  {est.geocodePrecision && (
                    <span
                      className="fr-badge fr-badge--sm fr-mt-1v"
                      style={{
                        backgroundColor: est.geocodePrecision === 'address' ? 'var(--background-contrast-success)' : 'var(--background-contrast-info)',
                        fontSize: '0.625rem'
                      }}
                    >
                      {est.geocodePrecision === 'address' ? 'Adresse précise' : 'Centre commune'}
                    </span>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
        {!isInset && <MapBoundsHandler establishments={establishments} territory={territory} />}
      </MapContainer>
    </div>
  );
};

// Composant principal de la carte
export const EstablishmentsMap = ({ data, title = "Carte des établissements" }) => {
  const { geocodedData, loading, progress, stats } = useGeocodedEstablishments(data);

  // Séparer les établissements par territoire
  const { metropoleCount, domCounts } = useMemo(() => {
    const metro = geocodedData.filter(e => {
      const dept = e.department?.toString().padStart(2, '0');
      return dept && !DOM_DEPT_CODES.includes(dept);
    }).length;

    const dom = {};
    Object.entries(TERRITORIES).forEach(([key, config]) => {
      if (key !== 'metropole' && config.deptCodes) {
        dom[key] = geocodedData.filter(e => {
          const dept = e.department?.toString().padStart(2, '0');
          return config.deptCodes.includes(dept);
        }).length;
      }
    });

    return { metropoleCount: metro, domCounts: dom };
  }, [geocodedData]);

  const hasDOM = Object.values(domCounts).some(count => count > 0);

  if (data.length === 0) {
    return null;
  }

  return (
    <div className="fr-mb-4w">
      <h3 className="fr-h6 fr-mb-2w">{title}</h3>

      {loading && (
        <div className="fr-callout fr-callout--brown-caramel fr-mb-2w" style={{ padding: '1rem' }}>
          <p className="fr-mb-0">
            <span className="spe-spinner fr-mr-2w" style={{ width: '1rem', height: '1rem' }} aria-hidden="true"></span>
            {progress || 'Chargement de la carte...'}
          </p>
        </div>
      )}

      {!loading && geocodedData.length === 0 && (
        <div className="fr-callout fr-mb-2w" style={{ padding: '1rem' }}>
          <p className="fr-mb-0">Aucun établissement géolocalisable.</p>
        </div>
      )}

      {!loading && geocodedData.length > 0 && (
        <div className="fr-grid-row fr-grid-row--gutters">
          {/* Carte principale - Métropole */}
          <div className={hasDOM ? "fr-col-12 fr-col-lg-9" : "fr-col-12"}>
            <TerritoryMap
              establishments={geocodedData}
              territory="metropole"
              config={TERRITORIES.metropole}
            />
            <p className="fr-text--xs fr-mt-1w fr-mb-0" style={{ color: 'var(--text-mention-grey)' }}>
              {metropoleCount} établissement{metropoleCount > 1 ? 's' : ''} en métropole
              {stats.siret > 0 && (
                <span style={{ color: 'var(--text-default-success)' }}>
                  {' '}• {stats.siret} géolocalisé{stats.siret > 1 ? 's' : ''} par adresse (SIRET)
                </span>
              )}
              {stats.insee > 0 && (
                <span style={{ color: 'var(--text-default-info)' }}>
                  {' '}• {stats.insee} par commune
                </span>
              )}
              {stats.failed > 0 && (
                <span style={{ color: 'var(--text-mention-grey)' }}>
                  {' '}• {stats.failed} non géolocalisé{stats.failed > 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>

          {/* Encarts Outre-mer */}
          {hasDOM && (
            <div className="fr-col-12 fr-col-lg-3">
              <p className="fr-text--sm fr-text--bold fr-mb-2w">Outre-mer</p>
              {Object.entries(TERRITORIES).map(([key, config]) => {
                if (key === 'metropole' || !domCounts[key] || domCounts[key] === 0) return null;
                return (
                  <TerritoryMap
                    key={key}
                    establishments={geocodedData}
                    territory={key}
                    config={config}
                    isInset
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EstablishmentsMap;
