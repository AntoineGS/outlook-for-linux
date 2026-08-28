const path = require('node:path');

const BROWSER_PRELOAD_ID = 'outlook-browser-preload';
const BROWSER_PRELOAD_PATH = path.join(__dirname, '..', 'browser', 'sessionPreload.js');

function registerBrowserPreload(session, partition) {
	if (typeof partition !== 'string' || partition.trim() === '') {
		throw new Error('Outlook browser preload requires a non-empty dedicated partition');
	}
	if (session.getPreloadScripts().some(script => script.id === BROWSER_PRELOAD_ID)) return;
	session.registerPreloadScript({
		id: BROWSER_PRELOAD_ID,
		type: 'frame',
		filePath: BROWSER_PRELOAD_PATH,
	});
}

module.exports = { registerBrowserPreload };
