const zmoraSpecialistInfo = {
  name: "zmora",
  mode: "subagent",
  description: "Execute a single QA scenario (FE or BE). Internally split into variants `zmora-fe` / `zmora-be`; Perun routes by scenario prefix. Dispatched once per scenario by Perun.",
  metadata: {
    triggers: []
  }
};
export {
  zmoraSpecialistInfo
};
