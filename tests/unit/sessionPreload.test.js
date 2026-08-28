const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const preloadPath = path.resolve(__dirname, '../../app/browser/sessionPreload.js');

function requiredModules(isMainFrame, hostname, protocol = 'https:') {
	assert.equal(fs.existsSync(preloadPath), true, 'session preload wrapper must exist');
	const modules = [];
	vm.runInNewContext(fs.readFileSync(preloadPath, 'utf8'), {
		process: { isMainFrame },
		location: { hostname, protocol },
		require: module => {
			if (module === '../product') {
				return {
					isAppHost: host => host === 'outlook.live.com',
					isAuthHost: host => host === 'login.live.com',
				};
			}
			modules.push(module);
		},
	});
	return modules;
}

test('loads the browser preload only in approved main frames', () => {
	assert.deepEqual(requiredModules(true, 'outlook.live.com'), ['./preload']);
	assert.deepEqual(requiredModules(true, 'login.live.com'), ['./preload']);
	assert.deepEqual(requiredModules(true, 'outlook.live.com', 'http:'), []);
	assert.deepEqual(requiredModules(true, 'example.com'), []);
	assert.deepEqual(requiredModules(false, 'outlook.live.com'), []);
});
