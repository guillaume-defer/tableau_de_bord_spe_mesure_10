// Fonction serverless Netlify - Proxy vers l'API data.gouv.fr
// Contourne les restrictions CORS
// Utilise le fichier CSV du Registre National des Cantines

exports.handler = async (event) => {
  // Récupérer les paramètres de la requête
  const params = event.queryStringParameters || {};
  
  // Ressources des télédéclarations par année de données
  const TD_RESOURCES = {
    '2024': '078cbd12-b553-4d0b-b74c-e79b19f7f61f', // Campagne 2025 sur données 2024
    '2023': '25570c1c-9288-4fed-9d82-0f42444e12ab', // Campagne 2024 sur données 2023
    '2022': '84a09799-0845-4055-9101-e3a1a00fac2f', // Campagne 2023 sur données 2022
    '2021': 'efe63a1a-c307-4238-81b0-ffa8536163c7'  // Campagne 2022 sur données 2021
  };
  
  // Ressources du Registre National des Cantines (avec fallback)
  const CANTINES_RESOURCES = [
    '3f73d129-6b24-45cd-95e9-9bacc216d9d9', // CSV (préféré)
    '408dca92-9028-4f66-93bf-f671111393ec'  // XLSX (fallback)
  ];
  
  // Déterminer quelle ressource utiliser
  let RESOURCE_IDS = [];
  
  if (params.source === 'teledeclarations') {
    const year = params.td_year || '2024';
    RESOURCE_IDS = [TD_RESOURCES[year] || TD_RESOURCES['2024']];
    delete params.source;
    delete params.td_year;
  } else {
    RESOURCE_IDS = CANTINES_RESOURCES;
  }
  
  const queryString = new URLSearchParams(params).toString();
  
  for (const RESOURCE_ID of RESOURCE_IDS) {
    const url = `https://tabular-api.data.gouv.fr/api/resources/${RESOURCE_ID}/data/${queryString ? '?' + queryString : ''}`;
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      
      if (response.ok) {
        const data = await response.json();
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=300',
          },
          body: JSON.stringify(data),
        };
      }
      
      if (RESOURCE_ID === RESOURCE_IDS[RESOURCE_IDS.length - 1]) {
        return {
          statusCode: response.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: `API error: ${response.status}` }),
        };
      }
    } catch (error) {
      if (RESOURCE_ID === RESOURCE_IDS[RESOURCE_IDS.length - 1]) {
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: error.message }),
        };
      }
    }
  }
};
