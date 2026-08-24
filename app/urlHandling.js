/**
 * Resolve a safe application launch URL without logging user-supplied values.
 *
 * @param {string[]} args command-line arguments
 * @param {{defaultUrl: string, protocol: string, isAppHost: (hostname: string) => boolean}} productConfig product contract
 * @returns {string|null} an allowed URL, or null when no argument is usable
 */
function resolveLaunchUrl(args, productConfig) {
  if (!Array.isArray(args)) return null;

  const protocolPrefix = `${productConfig.protocol}:`.toLowerCase();
  for (const arg of args) {
    if (typeof arg !== "string") continue;

    if (arg.toLowerCase().startsWith(protocolPrefix)) {
      return productConfig.defaultUrl;
    }

    try {
      const url = new URL(arg);
      if (url.protocol === "https:" && productConfig.isAppHost(url.hostname)) {
        return url.href;
      }
    } catch {
      // Ignore non-URL command-line arguments without exposing their values.
    }
  }

  return null;
}

module.exports = { resolveLaunchUrl };
