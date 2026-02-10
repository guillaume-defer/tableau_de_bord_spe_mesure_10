import { useMemo } from 'react';
import { AVAILABLE_TD_YEARS, CHART_COLORS } from '../utils/constants';
import { hasTeledeclaration } from '../utils/helpers';

export function HistoricalTrends({ data }) {
  // Calcul des taux de télédéclaration par année
  const yearlyStats = useMemo(() => {
    if (!data || data.length === 0) return [];

    const stats = AVAILABLE_TD_YEARS.map(year => {
      let declared = 0;
      let total = data.length;

      data.forEach(row => {
        if (hasTeledeclaration(row, year)) {
          declared++;
        }
      });

      return {
        year,
        declared,
        total,
        rate: total > 0 ? (declared / total) * 100 : 0
      };
    });

    return stats;
  }, [data]);

  if (yearlyStats.length === 0) return null;

  // Dimensions du graphique
  const width = 400;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Échelles
  const maxRate = Math.max(...yearlyStats.map(s => s.rate), 100);
  const xStep = chartWidth / (yearlyStats.length - 1 || 1);
  const yScale = (value) => chartHeight - (value / maxRate) * chartHeight;

  // Points de la ligne
  const points = yearlyStats.map((s, i) => ({
    x: i * xStep,
    y: yScale(s.rate),
    ...s
  }));

  // Ligne du graphique
  const linePath = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
  ).join(' ');

  // Aire sous la courbe
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${chartHeight} L 0 ${chartHeight} Z`;

  return (
    <div className="fr-callout fr-mb-3w">
      <p className="fr-callout__title">Évolution des télédéclarations</p>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', maxWidth: '500px', height: 'auto' }}
        role="img"
        aria-label="Graphique montrant l'évolution du taux de télédéclaration par année"
      >
        <g transform={`translate(${padding.left}, ${padding.top})`}>
          {/* Grille horizontale */}
          {[0, 25, 50, 75, 100].map(value => (
            <g key={value}>
              <line
                x1={0}
                y1={yScale(value)}
                x2={chartWidth}
                y2={yScale(value)}
                stroke="#e5e5e5"
                strokeDasharray={value === 0 ? "0" : "4"}
              />
              <text
                x={-8}
                y={yScale(value)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="10"
                fill="#666"
              >
                {value}%
              </text>
            </g>
          ))}

          {/* Aire sous la courbe */}
          <path
            d={areaPath}
            fill={CHART_COLORS[0]}
            fillOpacity="0.1"
          />

          {/* Ligne principale */}
          <path
            d={linePath}
            fill="none"
            stroke={CHART_COLORS[0]}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Points */}
          {points.map((p, i) => (
            <g key={p.year}>
              <circle
                cx={p.x}
                cy={p.y}
                r="5"
                fill={CHART_COLORS[0]}
              />
              {/* Valeur au-dessus du point */}
              <text
                x={p.x}
                y={p.y - 12}
                textAnchor="middle"
                fontSize="11"
                fontWeight="bold"
                fill={CHART_COLORS[0]}
              >
                {p.rate.toFixed(0)}%
              </text>
              {/* Année en bas */}
              <text
                x={p.x}
                y={chartHeight + 20}
                textAnchor="middle"
                fontSize="11"
                fill="#161616"
              >
                {p.year}
              </text>
            </g>
          ))}
        </g>
      </svg>

      <div className="fr-grid-row fr-grid-row--gutters fr-mt-2w">
        {yearlyStats.map((s, i) => (
          <div key={s.year} className="fr-col-6 fr-col-md-2" style={{ textAlign: 'center' }}>
            <p className="fr-text--xs fr-mb-0" style={{ color: '#666' }}>{s.year}</p>
            <p className="fr-text--bold fr-mb-0">{s.declared}/{s.total}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
