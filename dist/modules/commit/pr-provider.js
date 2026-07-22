const URL_SHAPES = [
  /^git@([^:/]+):[^/]+\/[^/]+?(?:\.git)?$/i,
  // scp-like SSH
  /^ssh:\/\/git@([^:/]+)(?::\d+)?\/[^/]+\/[^/]+?(?:\.git)?$/i,
  // SSH URL
  /^https:\/\/([^:/]+)\/[^/]+\/[^/]+?(?:\.git)?$/i
  // HTTPS
];
function detectProvider(originUrl) {
  if (/\s/.test(originUrl)) return void 0;
  for (const shape of URL_SHAPES) {
    const host = shape.exec(originUrl)?.[1];
    if (host?.toLowerCase() === "github.com") return "github";
  }
  return void 0;
}
export {
  detectProvider
};
