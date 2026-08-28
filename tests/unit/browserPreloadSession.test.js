const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../app/mainAppWindow/browserPreloadSession.js');

function loadRegistration() {
	try {
		return require(modulePath).registerBrowserPreload;
	} catch {
		return undefined;
	}
}

test('registers the browser preload on an Outlook session', () => {
	const registerBrowserPreload = loadRegistration();
	assert.equal(typeof registerBrowserPreload, 'function');

	const registrations = [];
	const session = {
		getPreloadScripts: () => [],
		registerPreloadScript: registration => registrations.push(registration),
	};
	registerBrowserPreload(session, 'persist:outlook-4-linux');

	assert.deepEqual(registrations, [{
		id: 'outlook-browser-preload',
		type: 'frame',
		filePath: path.resolve(__dirname, '../../app/browser/sessionPreload.js'),
	}]);
});

test('does not register the browser preload twice on one session', () => {
	const registerBrowserPreload = loadRegistration();
	assert.equal(typeof registerBrowserPreload, 'function');

	let registrationCount = 0;
	const session = {
		getPreloadScripts: () => [{
			id: 'outlook-browser-preload',
			type: 'frame',
			filePath: path.resolve(__dirname, '../../app/browser/sessionPreload.js'),
		}],
		registerPreloadScript: () => { registrationCount++; },
	};
	registerBrowserPreload(session, 'persist:outlook-4-linux');

	assert.equal(registrationCount, 0);
});

test('rejects the shared default session partition', () => {
	const registerBrowserPreload = loadRegistration();
	let registrationCount = 0;
	const session = {
		getPreloadScripts: () => [],
		registerPreloadScript: () => { registrationCount++; },
	};

	assert.throws(
		() => registerBrowserPreload(session, '  '),
		/Outlook browser preload requires a non-empty dedicated partition/,
	);
	assert.equal(registrationCount, 0);
});
