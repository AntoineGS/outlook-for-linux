const product = require('../product');

if (process.isMainFrame && globalThis.location.protocol === 'https:' &&
	(product.isAppHost(globalThis.location.hostname) || product.isAuthHost(globalThis.location.hostname))) {
	require('./preload');
}
