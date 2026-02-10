import { useState, useEffect } from 'react';
import { API_PROXY } from '../utils/constants';

export function CampaignBanner() {
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCampaign = async () => {
      try {
        // Récupérer la campagne de l'année en cours (données de l'année précédente)
        const currentYear = new Date().getFullYear();
        const response = await fetch(`${API_PROXY}?source=ma-cantine&endpoint=campaignDates&year=${currentYear}`);

        if (response.ok) {
          const data = await response.json();
          setCampaign(data);
        }
      } catch (e) {
        console.error('Erreur chargement campagne:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchCampaign();
  }, []);

  if (loading || !campaign) return null;

  // Vérifier si une période est active
  const isActive = campaign.inTeledeclaration || campaign.inCorrection;
  if (!isActive) return null;

  // Calculer les jours restants
  const endDate = campaign.inTeledeclaration
    ? new Date(campaign.teledeclarationEndDate)
    : new Date(campaign.correctionEndDate);

  const now = new Date();
  const daysRemaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));

  if (daysRemaining < 0) return null;

  const periodLabel = campaign.inTeledeclaration ? 'télédéclaration' : 'correction';
  const dataYear = campaign.year - 1;

  // Couleur selon urgence
  const alertType = daysRemaining <= 7 ? 'fr-alert--error' :
                    daysRemaining <= 30 ? 'fr-alert--warning' :
                    'fr-alert--info';

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };

  return (
    <div className={`fr-alert ${alertType} fr-mb-3w`}>
      <h3 className="fr-alert__title">
        Campagne {campaign.year} en cours
      </h3>
      <p>
        La période de {periodLabel} pour les données {dataYear} est ouverte jusqu'au{' '}
        <strong>{formatDate(endDate)}</strong>.
        {daysRemaining <= 30 && (
          <>
            {' '}Il reste <strong>{daysRemaining} jour{daysRemaining > 1 ? 's' : ''}</strong>.
          </>
        )}
      </p>
      <p className="fr-mt-1w">
        <a
          href="https://ma-cantine.agriculture.gouv.fr/gestionnaire"
          target="_blank"
          rel="noopener noreferrer"
          className="fr-link"
        >
          Accéder à ma-cantine pour télédéclarer
          <span className="fr-icon-external-link-line fr-icon--sm fr-ml-1w" aria-hidden="true"></span>
        </a>
      </p>
    </div>
  );
}
