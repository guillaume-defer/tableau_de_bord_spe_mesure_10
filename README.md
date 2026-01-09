# Tableau de bord SPE - Mesure 10

Tableau de bord de suivi des établissements de restauration collective dans le cadre de la **Mesure 10 des Services Publics Écoresponsables (SPE)**.

## 🎯 Objectif

Permettre le suivi en temps réel des établissements de restauration collective des ministères et services déconcentrés de l'État, conformément aux obligations de la loi EGAlim et du dispositif SPE.

## ✨ Fonctionnalités

- **Vue Ministère** : Suivi par ministère de tutelle
- **Vue ATE Région** : Suivi par région (Administration Territoriale de l'État)
- **Indicateurs clés** : Taux d'inscription, comptes actifs, couverts moyens
- **Classification SPE** : Identification automatique des établissements selon leur périmètre SPE
- **Données EGAlim** : Affichage des taux bio et qualité par établissement
- **Export** : Téléchargement des données filtrées au format CSV/XLSX
- **Mode sombre** : Interface adaptée DSFR avec thème clair/sombre

## 🛠️ Technologies

- **Frontend** : React (via CDN), DSFR (Système de Design de l'État)
- **Backend** : Netlify Functions (serverless)
- **Données** : API data.gouv.fr (Registre National des Cantines)
- **Hébergement** : Netlify

## 📊 Sources de données

- [Registre National des Cantines](https://www.data.gouv.fr/fr/datasets/registre-national-des-cantines/) - data.gouv.fr
- [Télédéclarations EGAlim](https://www.data.gouv.fr/fr/datasets/resultats-de-campagnes-de-teledeclaration-des-cantines/) - data.gouv.fr

## 🚀 Déploiement

### Via Netlify (recommandé)

1. Connectez ce repository à Netlify
2. Netlify détectera automatiquement la configuration (`netlify.toml`)
3. Le site sera déployé automatiquement à chaque push

### Configuration

Aucune variable d'environnement requise. Le proxy API (`netlify/functions/api-proxy.js`) gère les appels vers data.gouv.fr.

## 📁 Structure du projet

```
.
├── index.html                    # Application React (single-page)
├── netlify.toml                  # Configuration Netlify
├── netlify/
│   └── functions/
│       └── api-proxy.js          # Proxy serverless vers data.gouv.fr
└── README.md
```

## 🔧 Développement local

Pour tester localement avec Netlify CLI :

```bash
npm install -g netlify-cli
netlify dev
```

Le site sera accessible sur `http://localhost:8888`.

## 📜 Licence

Licence Ouverte / Open Licence version 2.0 - [Etalab](https://www.etalab.gouv.fr/licence-ouverte-open-licence)

## 👥 Contact

Direction générale de l'alimentation (DGAL)  
Ministère de l'Agriculture, de l'Agroalimentaire et de la Souveraineté alimentaire
