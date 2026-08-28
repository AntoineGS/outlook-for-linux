const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

test('registers the session preload before constructing the Outlook window', async () => {
	const registrations = [];
	const events = [];
	const outlookSession = {
		getPreloadScripts: () => [],
		registerPreloadScript: registration => {
			registrations.push(registration);
			events.push('register');
		},
	};
	let browserWindowOptions;
	class BrowserWindow extends EventEmitter {
		constructor(options) {
			super();
			browserWindowOptions = options;
			events.push('construct');
			this.webContents = new EventEmitter();
		}
	}

	const electronPath = require.resolve('electron');
	const windowStatePath = require.resolve('electron-window-state');
	const screenSharingPath = require.resolve('../../app/screenSharing');
	const incomingCallToastPath = require.resolve('../../app/incomingCallToast');
	const featureIpcPath = require.resolve('../../app/security/featureIpc');
	const storagePartitionsPath = require.resolve('../../app/utils/storagePartitions');
	require.cache[electronPath] = {
		id: electronPath,
		filename: electronPath,
		loaded: true,
		exports: {
			app: new EventEmitter(),
			BrowserWindow,
			ipcMain: new EventEmitter(),
			nativeImage: { createFromPath: () => undefined },
			nativeTheme: { shouldUseDarkColors: false },
			powerSaveBlocker: {},
			session: { fromPartition: partition => {
				assert.equal(partition, 'persist:outlook-4-linux');
				return outlookSession;
			} },
		},
	};
	require.cache[windowStatePath] = {
		id: windowStatePath, filename: windowStatePath, loaded: true,
		exports: () => ({ manage: () => {} }),
	};
	require.cache[screenSharingPath] = {
		id: screenSharingPath, filename: screenSharingPath, loaded: true,
		exports: { StreamSelector: class {} },
	};
	require.cache[incomingCallToastPath] = {
		id: incomingCallToastPath, filename: incomingCallToastPath, loaded: true,
		exports: class {},
	};
	require.cache[featureIpcPath] = {
		id: featureIpcPath, filename: featureIpcPath, loaded: true,
		exports: { registerFeatureIpc: () => {} },
	};
	require.cache[storagePartitionsPath] = {
		id: storagePartitionsPath, filename: storagePartitionsPath, loaded: true,
		exports: { collectPartitionsToClear: () => [], clearStorageForPartitions: async () => {} },
	};

	const managerPath = require.resolve('../../app/mainAppWindow/browserWindowManager');
	delete require.cache[managerPath];
	const BrowserWindowManager = require(managerPath);
	const manager = new BrowserWindowManager({
		config: {
			partition: 'persist:outlook-4-linux',
			menubar: 'hidden',
			frame: true,
			screenSharing: { lockInhibitionMethod: 'Electron' },
		},
	});

	await manager.createWindow();

	assert.deepEqual(events.slice(0, 2), ['register', 'construct']);
	assert.equal(registrations.length, 1);
	assert.equal(browserWindowOptions.webPreferences.preload, undefined);
});
