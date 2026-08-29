const STYLE_ID = 'ofl-ad-suppression';

const AD_SUPPRESSION_CSS = `
#app > .ms-Fabric > div[class] > div[class] > div[class]:has(> div > div > div[id^="owaadbar"]),
div:has(> div[id^="owaadbar"]),
#app > div[class] > div[class] > div[class] > div[class]:not(.ms-FocusZone):not([class^="screenReaderText"]) div[data-max-width] + div[class]:has(> div[class] > div > div[id^="owaadbar"]),
div[tabindex="0"]:has(img[src$="/assets/ads/adbarmetrochoice.svg"]),
div.customScrollBar > div > div[id][class]:has(img[src$="/images/ads-olk-icon.png"]),
div:has(> div > div.fbAdLink),
[data-app-section="MessageList"] div[style^="position: absolute; left: 0px; top: 0px"]:has(.ms-Shimmer-container) {
  display: none !important;
}
`;

function init(_config, rootDocument = globalThis.document) {
  if (!rootDocument?.head || typeof rootDocument.head.appendChild !== 'function'
    || typeof rootDocument.createElement !== 'function'
    || typeof rootDocument.getElementById !== 'function') {
    return false;
  }

  if (rootDocument.getElementById(STYLE_ID)) {
    return true;
  }

  const style = rootDocument.createElement('style');
  style.id = STYLE_ID;
  style.textContent = AD_SUPPRESSION_CSS;
  rootDocument.head.appendChild(style);
  return true;
}

module.exports = { init };
