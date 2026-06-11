const SETUP_AGENT_KEY = "zmora-setup";
function makeCallerGate(deps) {
  return {
    isSetupCaller: (sessionID) => deps.registry.lookup(sessionID) === deps.setupAgentKey,
    isCoordinatorCaller: (sessionID) => deps.registry.lookup(sessionID) === void 0
  };
}
export {
  SETUP_AGENT_KEY,
  makeCallerGate
};
