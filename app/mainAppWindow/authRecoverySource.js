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
    const url = new URL(sourceUrl);
    return url.protocol === "https:"
      && url.port === ""
      && !url.username
      && !url.password
      && (product.isAppHost(url.hostname) || product.isAuthHost(url.hostname));
  } catch {
    return false;
  }
}

module.exports = { getAuthoritativeSenderUrl, isApprovedRendererSource };
