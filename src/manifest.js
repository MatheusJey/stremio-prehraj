const manifest = {
  id: "community.prehrajto",
  version: "0.1.0",
  name: "Přehraj.to",
  description: "Returns direct HTTP video streams sourced from Přehraj.to search results.",
  logo: "https://prehraj.to/favicon.ico",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: {
    configurable: true,
    configurationRequired: false
  },
  config: [
    {
      key: "prehraj_token",
      type: "text",
      title: "Přehraj.to session cookie (optional, for premium quality)",
      required: false
    },
    {
      key: "min_size_mb",
      type: "number",
      title: "Minimum file size in MB (filters tiny/sample results)",
      default: 100,
      required: false
    },
    {
      key: "max_results",
      type: "number",
      title: "Maximum number of streams to return",
      default: 20,
      required: false
    }
  ]
};

module.exports = manifest;
