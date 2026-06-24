function makePreflightHandler(deps) {
  return async (args, ctx) => {
    const parentID = await deps.resolveParentID(ctx.sessionID) ?? ctx.sessionID;
    deps.state.addDeclaredEnv(parentID, args.env);
    const missing = [];
    const seen = /* @__PURE__ */ new Set();
    for (const name of args.env) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (deps.store.getBinding(parentID, name) !== void 0) continue;
      const fromEnv = deps.processEnv[name];
      if (typeof fromEnv === "string" && fromEnv.length > 0) continue;
      missing.push(name);
    }
    return missing.length === 0 ? { status: "ok" } : { status: "missing", missing };
  };
}
export {
  makePreflightHandler
};
