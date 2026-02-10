import { useState, useEffect } from 'react';
import { API_PROXY } from '../utils/constants';

export function CampaignBanner() {
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchCampaign = async () => {
      try {
        // Récupérer la campagne de l'année en cours
        const currentYear = new Date().getFullYear();
        const url = `${API_PROXY}?source=ma-cantine&endpoint=campaignDates&year=${currentYear}`;

        console.log('[CampaignBanner] Fetching:', url);
        const response = await fetch(url);

        if (response.ok) {
          const data = await response.json();
          console.log('[CampaignBanner] Response:', data);
          setCampaign(data);
        } else {
          const errorText = await response.text();
          console.error('[CampaignBanner] API error:', response.status, errorText);
          setError(`Erreur API: ${response.status}`);
        }
      } catch (e) {
        console.error('[CampaignBanner] Fetch error:', e);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    fetchCampaign();
  }, []);

  // Ne rien afficher pendant le chargement
  if (loading) return null;

  // En cas d'erreur, ne rien afficher (le bandeau n'est pas critique)
  if (error) {
    console.warn('[CampaignBanner] Erreur, bandeau non affiché:', error);
    return null;
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };

  // Campagne ouverte (télédéclaration ou correction)
  if (campaign?.inTeledeclaration || campaign?.inCorrection) {
    const endDate = campaign.inTeledeclaration
      ? campaign.teledeclarationEndDate
      : campaign.correctionEndDate;
    const periodLabel = campaign.inTeledeclaration ? 'télédéclaration' : 'correction';
    const dataYear = campaign.year - 1;

    return (
      <div className="fr-alert fr-alert--info fr-mb-4w">
        <h3 className="fr-alert__title">
          Campagne {campaign.year} en cours
        </h3>
        <p>
          La période de {periodLabel} pour les données {dataYear} est ouverte jusqu'au{' '}
          <strong>{formatDate(endDate)}</strong>.
        </p>
        <p className="fr-mt-1w">
          <a
            href="https://agriculture.gouv.fr/restauration-collective-ouverture-de-la-campagne-de-teledeclaration-2026-sur-les-achats-de-produits"
            target="_blank"
            rel="noopener noreferrer"
            className="fr-link"
          >
            Consulter le communiqué de presse
            <span className="fr-icon-external-link-line fr-icon--sm fr-ml-1w" aria-hidden="true"></span>
          </a>
        </p>
      </div>
    );
  }

  // Campagne fermée : afficher lien vers les rapports
  return (
    <div className="fr-notice fr-notice--info fr-mb-4w">
      <div className="fr-container">
        <div className="fr-notice__body">
          <p className="fr-notice__title">
            <a
              href="https://ma-cantine.crisp.help/fr/article/rapports-bilans-statistiques-egalim-de-la-restauration-collective-18z8ru0/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Consulter les rapports bilans statistiques EGalim
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
