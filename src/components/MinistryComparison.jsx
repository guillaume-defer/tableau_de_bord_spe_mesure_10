import { useState, useEffect } from 'react';
import { API_PROXY, MINISTERES, CHART_COLORS } from '../utils/constants';

export function MinistryComparison({ selectedYear, currentMinistry }) {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;

    const fetchAllMinistries = async () => {
      setLoading(true);

      try {
        // Charger les stats pour chaque ministère en parallèle
        const promises = MINISTERES.map(async (ministry) => {
          try {
            // Récupérer le nombre total d'établissements
            const countResponse = await fetch(
              `${API_PROXY}?line_ministry__exact=${encodeURIComponent(ministry)}&page_size=1`
            );
            if (!countResponse.ok) return null;
            const countData = await countResponse.json();
            const total = countData.meta?.total || countData.total_count || 0;

            if (total === 0) return null;

            // Récupérer le nombre de télédéclarations
            const tdResponse = await fetch(
              `${API_PROXY}?source=teledeclarations&td_year=${selectedYear}&canteen_line_ministry__exact=${encodeURIComponent(ministry)}&page_size=1`
            );
            if (!tdResponse.ok) return { ministry, total, declared: 0, rate: 0 };
            const tdData = await tdResponse.json();
            const declared = tdData.meta?.total || tdData.total_count || 0;

            return {
              ministry,
              total,
              declared,
              rate: total > 0 ? (declared / total) * 100 : 0
            };
          } catch (e) {
            console.error(`Erreur pour ${ministry}:`, e);
            return null;
          }
        });

        const results = await Promise.all(promises);
        const validResults = results
          .filter(r => r !== null && r.total > 0)
          .sort((a, b) => b.rate - a.rate);

        setStats(validResults);
      } catch (e) {
        console.error('Erreur chargement comparaison:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchAllMinistries();
  }, [expanded, selectedYear]);

  if (!expanded) {
    return (
      <div className="fr-callout fr-mb-3w">
        <p className="fr-callout__title">Comparaison inter-ministérielle</p>
        <p className="fr-callout__text">
          Comparez les taux de télédéclaration entre les différents ministères.
        </p>
        <button
          className="fr-btn fr-btn--secondary fr-btn--sm"
          onClick={() => setExpanded(true)}
        >
          Afficher la comparaison
        </button>
      </div>
    );
  }

  const maxRate = Math.max(...stats.map(s => s.rate), 1);

  return (
    <div className="fr-callout fr-mb-3w">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <p className="fr-callout__title fr-mb-0">
          Comparaison inter-ministérielle ({selectedYear})
        </p>
        <button
          className="fr-btn fr-btn--tertiary-no-outline fr-btn--sm"
          onClick={() => setExpanded(false)}
          aria-label="Fermer la comparaison"
        >
          <span className="fr-icon-close-line" aria-hidden="true"></span>
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="spe-spinner"></div>
          <p className="fr-mt-2w">Chargement des données de tous les ministères...</p>
        </div>
      ) : (
        <div className="fr-table" style={{ overflow: 'visible' }}>
          <table>
            <thead>
              <tr>
                <th scope="col">Ministère</th>
                <th scope="col" style={{ width: '120px', textAlign: 'right' }}>Taux TD</th>
                <th scope="col" style={{ width: '200px' }}>Progression</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr
                  key={s.ministry}
                  style={{
                    backgroundColor: s.ministry === currentMinistry ? 'var(--background-alt-blue-france)' : undefined
                  }}
                >
                  <td>
                    <span className="fr-text--sm">
                      {s.ministry === currentMinistry && (
                        <span className="fr-icon-arrow-right-s-line fr-icon--sm fr-mr-1v" aria-hidden="true"></span>
                      )}
                      {s.ministry}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={`fr-badge fr-badge--sm ${
                      s.rate >= 50 ? 'fr-badge--success' :
                      s.rate >= 25 ? 'fr-badge--warning' :
                      'fr-badge--error'
                    }`}>
                      {s.rate.toFixed(1)}%
                    </span>
                  </td>
                  <td>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}>
                      <div style={{
                        flex: 1,
                        height: '12px',
                        backgroundColor: '#e5e5e5',
                        borderRadius: '6px',
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          width: `${(s.rate / maxRate) * 100}%`,
                          height: '100%',
                          backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                          borderRadius: '6px',
                          transition: 'width 0.3s ease'
                        }} />
                      </div>
                      <span className="fr-text--xs" style={{ color: '#666', minWidth: '60px' }}>
                        {s.declared}/{s.total}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
