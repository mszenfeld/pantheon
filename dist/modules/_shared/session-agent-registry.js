class SessionAgentRegistry {
  #map = /* @__PURE__ */ new Map();
  #metadata = /* @__PURE__ */ new Map();
  register(sessionID, agent) {
    this.registerWithMetadata(sessionID, agent, {});
  }
  registerWithMetadata(sessionID, agent, metadata) {
    this.#map.set(sessionID, agent);
    this.#metadata.set(sessionID, metadata);
  }
  unregister(sessionID) {
    this.#map.delete(sessionID);
    this.#metadata.delete(sessionID);
  }
  lookupMetadata(sessionID) {
    return this.#metadata.get(sessionID);
  }
  lookup(sessionID) {
    return this.#map.get(sessionID);
  }
}
export {
  SessionAgentRegistry
};
