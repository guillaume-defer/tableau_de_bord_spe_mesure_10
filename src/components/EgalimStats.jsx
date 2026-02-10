import { useMemo } from 'react';
import { EGALIM_OBJECTIVES, EGALIM_THRESHOLDS } from '../utils/constants';

// Jauge circulaire SVG
function GaugeChart({ value, objective, label, unit = '%' }) {
  const percentage = Math.min((value / objective) * 100, 100);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  // Couleur selon le seuil atteint
  const getColor = () => {
    const ratio = value / objective;
    if (ratio >= EGALIM_THRESHOLDS.warning) return '#18753C'; // Vert succès DSFR
    if (ratio >= EGALIM_THRESHOLDS.critical) return '#B34000'; // Orange avertissement DSFR
    return '#CE0500'; // Rouge erreur DSFR
  };

  const color = getColor();

  return (
    <div style={{ textAlign: 'center', minWidth: '120px' }}>
      <svg width="100" height="100" viewBox="0 0 100 100">
        {/* Cercle de fond */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="#e5e5e5"
          strokeWidth="8"
        />
        {/* Cercle de progression */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
        {/* Valeur au centre */}
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: '18px', fontWeight: 'bold', fill: color }}
        >
          {value !== null ? `${value.toFixed(1)}${unit}` : '-'}
        </text>
      </svg>
      <p className="fr-text--sm fr-mb-0" style={{ fontWeight: 500 }}>{label}</p>
      <p className="fr-text--xs fr-mb-0" style={{ color: '#666' }}>
        Objectif : {objective}{unit}
      </p>
    </div>
  );
}

export function EgalimStats({ data, teledeclarations, selectedYear }) {
  // Calcul des moyennes pondérées par le nombre de repas
  const stats = useMemo(() => {
    if (!data || data.length === 0) {
      return { bio: null, durable: null, total: null, count: 0, totalMeals: 0 };
    }

    let sumBio = 0;
    let sumEgalim = 0;
    let totalMeals = 0;
    let count = 0;

    data.forEach(row => {
      const siret = row.siret;
      const td = teledeclarations[siret]?.[selectedYear];

      if (td && td.ratio_bio !== null && td.ratio_bio !== undefined) {
        // Utiliser yearly_meal_count comme poids, fallback sur daily_meal_count * 200
        const meals = row.yearly_meal_count || (row.daily_meal_count ? row.daily_meal_count * 200 : 0);

        if (meals > 0) {
          const ratioBio = parseFloat(td.ratio_bio) || 0;
          const ratioEgalim = parseFloat(td.ratio_egalim) || 0;

          sumBio += ratioBio * meals;
          sumEgalim += ratioEgalim * meals;
          totalMeals += meals;
          count++;
        }
      }
    });

    if (totalMeals === 0) {
      return { bio: null, durable: null, total: null, count: 0, totalMeals: 0 };
    }

    const bioPercent = (sumBio / totalMeals) * 100;
    const egalimPercent = (sumEgalim / totalMeals) * 100;
    const totalPercent = bioPercent + egalimPercent;

    return {
      bio: bioPercent,
      durable: totalPercent,
      egalimHorsBio: egalimPercent,
      count,
      totalMeals
    };
  }, [data, teledeclarations, selectedYear]);

  if (stats.count === 0) {
    return (
      <div className="fr-callout fr-callout--brown-caramel fr-mb-3w">
        <p className="fr-callout__title">Performance EGAlim</p>
        <p className="fr-callout__text">
          Aucune donnée de télédéclaration avec nombre de repas disponible pour calculer les statistiques EGAlim.
        </p>
      </div>
    );
  }

  return (
    <div className="fr-callout fr-mb-3w">
      <p className="fr-callout__title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        Performance EGAlim {selectedYear}
        <button
          className="fr-btn--tooltip fr-btn"
          type="button"
          aria-describedby="tooltip-egalim-info"
          style={{ padding: 0, minHeight: 'auto', background: 'none' }}
        >
          <span className="fr-icon-question-line fr-icon--sm" aria-hidden="true"></span>
        </button>
        <span className="fr-tooltip fr-placement" id="tooltip-egalim-info" role="tooltip" aria-hidden="true">
          Moyennes pondérées par le nombre de repas annuels. Basé sur {stats.count} établissements ayant télédéclaré.
        </span>
      </p>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1.5rem',
        justifyContent: 'center',
        marginTop: '1rem'
      }}>
        <GaugeChart
          value={stats.bio}
          objective={EGALIM_OBJECTIVES.bio}
          label="Bio"
        />
        <GaugeChart
          value={stats.durable}
          objective={EGALIM_OBJECTIVES.durable}
          label="Durable (total)"
        />
      </div>

      <p className="fr-text--xs fr-mt-2w fr-mb-0" style={{ textAlign: 'center', color: '#666' }}>
        Basé sur {stats.count.toLocaleString('fr-FR')} établissements et {stats.totalMeals.toLocaleString('fr-FR')} repas/an
      </p>
    </div>
  );
}
