const product = require("../product");

function getAuthoritativeSenderUrl(event) {
  const senderUrl = event?.senderFrame?.url;
  if (typeof senderUrl !== "string" || senderUrl.length === 0) {
    return null;
  }

  try {
    new URL(senderUrl);
    return senderUrl;
  } catch {
    return null;
  }
}

function isApprovedRendererSource(sourceUrl) {
  if (typeof sourceUrl !== "string" || sourceUrl.length === 0) {
    return false;
  }

  try {
    const hostname = new URL(sourceUrl).hostname;
    return product.isAppHost(hostname) || product.isAuthHost(hostname);
  } catch {
    return false;
  }
}

module.exports = { getAuthoritativeSenderUrl, isApprovedRendererSource };
