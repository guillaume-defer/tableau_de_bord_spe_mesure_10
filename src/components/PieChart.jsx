import { CHART_COLORS } from '../utils/constants';

export function PieChart({ data, title }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) return null;

  const size = 180;
  const radius = 70;
  const center = size / 2;
  let currentAngle = 0;

  const slices = data.map((item, index) => {
    const angle = (item.value / total) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;

    const startRad = (startAngle - 90) * Math.PI / 180;
    const endRad = (endAngle - 90) * Math.PI / 180;

    const x1 = center + radius * Math.cos(startRad);
    const y1 = center + radius * Math.sin(startRad);
    const x2 = center + radius * Math.cos(endRad);
    const y2 = center + radius * Math.sin(endRad);

    const largeArc = angle > 180 ? 1 : 0;
    const pathData = angle >= 359.9
      ? `M ${center} ${center - radius} A ${radius} ${radius} 0 1 1 ${center - 0.01} ${center - radius} Z`
      : `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;

    const pct = (item.value / total) * 100;
    const pctStr = pct % 1 === 0 ? Math.round(pct) : pct.toFixed(1);

    return {
      path: pathData,
      color: CHART_COLORS[index % CHART_COLORS.length],
      label: item.label,
      value: item.value,
      pct: pctStr
    };
  });

  return (
    <div className="spe-chart-container">
      <p className="spe-chart-title">{title}</p>
      <div className="spe-chart-wrapper">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          {slices.map((slice, i) => (
            <path key={i} d={slice.path} fill={slice.color} stroke="white" strokeWidth="1" />
          ))}
        </svg>
        <div className="spe-chart-legend" role="list" aria-label="Légende du graphique">
          {slices.map((slice, i) => (
            <div key={i} className="spe-chart-legend-item" role="listitem">
              <span className="spe-chart-legend-color" style={{ backgroundColor: slice.color }} aria-hidden="true"></span>
              <span>{slice.label} ({slice.value} | {slice.pct} %)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
