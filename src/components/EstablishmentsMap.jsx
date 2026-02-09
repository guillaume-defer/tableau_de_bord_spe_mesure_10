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

// Cache des coordonnées par code INSEE (persisté en sessionStorage)
const COORDS_CACHE_KEY = 'spe_communes_coords';

const getCoordsCacheFromStorage = () => {
  try {
    const cached = sessionStorage.getItem(COORDS_CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
};

const saveCoordsCache = (cache) => {
  try {
    sessionStorage.setItem(COORDS_CACHE_KEY, JSON.stringify(cache));
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
const useGeocodedEstablishments = (establishments) => {
  const [geocodedData, setGeocodedData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const coordsCache = useRef(getCoordsCacheFromStorage());

  useEffect(() => {
    if (!establishments || establishments.length === 0) {
      setGeocodedData([]);
      return;
    }

    const geocodeAll = async () => {
      setLoading(true);
      const results = [];
      const uniqueInseeCodes = [...new Set(establishments.map(e => e.city_insee_code).filter(Boolean))];
      const codesToFetch = uniqueInseeCodes.filter(code => !coordsCache.current[code]);

      // Fetch missing coordinates in batches
      if (codesToFetch.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < codesToFetch.length; i += batchSize) {
          const batch = codesToFetch.slice(i, i + batchSize);
          setProgress(`Géocodage ${Math.min(i + batchSize, codesToFetch.length)}/${codesToFetch.length} communes...`);

          await Promise.all(batch.map(async (inseeCode) => {
            try {
              const response = await fetch(`https://geo.api.gouv.fr/communes/${inseeCode}?fields=centre`);
              if (response.ok) {
                const data = await response.json();
                if (data.centre?.coordinates) {
                  // API returns [lng, lat], Leaflet needs [lat, lng]
                  coordsCache.current[inseeCode] = [data.centre.coordinates[1], data.centre.coordinates[0]];
                }
              }
            } catch {
              // Ignore geocoding errors
            }
          }));

          // Small delay to avoid rate limiting
          if (i + batchSize < codesToFetch.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        // Save cache
        saveCoordsCache(coordsCache.current);
      }

      // Map establishments to coordinates
      establishments.forEach(est => {
        const coords = coordsCache.current[est.city_insee_code];
        if (coords) {
          results.push({
            ...est,
            coordinates: coords
          });
        }
      });

      setGeocodedData(results);
      setLoading(false);
      setProgress('');
    };

    geocodeAll();
  }, [establishments]);

  return { geocodedData, loading, progress };
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
  let size = 'small';
  let className = 'spe-marker-cluster-small';

  if (count >= 100) {
    size = 'large';
    className = 'spe-marker-cluster-large';
  } else if (count >= 10) {
    size = 'medium';
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
                  {est.sector_list && (
                    <>
                      <br />
                      <span className="fr-text--xs">{est.sector_list}</span>
                    </>
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
  const { geocodedData, loading, progress } = useGeocodedEstablishments(data);

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
              {geocodedData.length < data.length && ` (${data.length - geocodedData.length} non géolocalisé${data.length - geocodedData.length > 1 ? 's' : ''})`}
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
