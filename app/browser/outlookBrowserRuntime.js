const outlookAdSuppressor = require('./tools/outlookAdSuppressor');
const { createVimBindings } = require('./tools/vimBindings');

outlookAdSuppressor.init(__OFL_CONFIG__);
const vimController = createVimBindings({
	document: globalThis.document,
	MutationObserverClass: globalThis.MutationObserver,
	manageFrames: false,
});
vimController.init(__OFL_CONFIG__);
globalThis.addEventListener('pagehide', event => {
	if (!event.persisted) vimController.destroy();
}, { once: true });
