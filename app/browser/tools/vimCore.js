const NORMAL_KEYS = new Set([
	'h', 'j', 'k', 'l', 'w', 'b', 'e', '0', '^', '$', 'G',
	'i', 'a', 'I', 'A', 'o', 'O', 'x', 'D', 'C', 'p', 'P',
	'u', 'v', 'V', '.', '<C-r>',
]);
const OPERATORS = new Set(['d', 'c', 'y']);
const OPERATOR_MOTIONS = new Set([
	'h', 'j', 'k', 'l', 'w', 'b', 'e', '0', '^', '$', 'G', 'g',
]);

function createCodeMirrorShim(platform = globalThis.navigator?.userAgentData?.platform ??
	globalThis.navigator?.platform ?? '') {
	function CodeMirror() {}
	const listenerTopology = [];
	CodeMirror.isMac = /^mac/i.test(platform);
	CodeMirror.Pos = function Pos(line, ch) { this.line = line; this.ch = ch; };
	CodeMirror.isWordChar = value => /^[\p{L}\p{N}_]$/u.test(value);
	CodeMirror.commands = {
		cursorCharLeft: cm => cm.moveH(-1, 'char'),
		newlineAndIndent: cm => cm.replaceSelection('\n'),
		redo: cm => cm.execCommand('redo'),
		undo: cm => cm.execCommand('undo'),
	};
	CodeMirror.keys = {};
	CodeMirror.addClass = (element, name) => element?.classList?.add(name);
	CodeMirror.rmClass = (element, name) => element?.classList?.remove(name);
	CodeMirror.e_preventDefault = event => event?.preventDefault?.();
	CodeMirror.e_stop = event => {
		event?.preventDefault?.();
		event?.stopPropagation?.();
	};
	CodeMirror.keyName = event => {
		let name = event.key;
		if (name === ' ') name = 'Space';
		if (name === 'Esc') name = 'Escape';
		if (name === 'Del') name = 'Delete';
		if (event.altKey) name = `Alt-${name}`;
		if (event.ctrlKey) name = `Ctrl-${name}`;
		if (event.metaKey) name = `Cmd-${name}`;
		if (event.shiftKey) name = `Shift-${name}`;
		return name;
	};
	CodeMirror.on = (emitter, type, listener) => {
		if (typeof emitter.on === 'function') return emitter.on(type, listener);
		const result = emitter.addEventListener?.(type, listener);
		if (typeof emitter.addEventListener === 'function') listenerTopology.push({ emitter, type, listener });
		return result;
	};
	CodeMirror.off = (emitter, type, listener) => {
		if (typeof emitter.off === 'function') return emitter.off(type, listener);
		try {
			return emitter.removeEventListener?.(type, listener);
		} finally {
			const index = listenerTopology.findIndex(entry => entry.emitter === emitter && entry.type === type && entry.listener === listener);
			if (index >= 0) listenerTopology.splice(index, 1);
		}
	};
	CodeMirror.snapshotListenerTopology = () => listenerTopology.slice();
	CodeMirror.restoreListenerTopology = snapshot => {
		const remaining = listenerTopology.slice();
		for (const entry of remaining) {
			const index = snapshot.findIndex(candidate => candidate.emitter === entry.emitter && candidate.type === entry.type && candidate.listener === entry.listener);
			if (index >= 0) snapshot.splice(index, 1);
			else CodeMirror.off(entry.emitter, entry.type, entry.listener);
		}
		for (const entry of snapshot) CodeMirror.on(entry.emitter, entry.type, entry.listener);
	};
	CodeMirror.signal = (emitter, type, ...args) => emitter.signal(type, ...args);
	CodeMirror.lookupKey = (key, _keyMap, callback) => {
		const handlers = {
			Backspace: cm => cm.deleteBackward(),
			Delete: cm => cm.deleteForward(),
		};
		if (/^(?:(?:Alt|Ctrl|Cmd|Shift)-)+(?:Backspace|Delete)$/.test(key)) {
			return callback(cm => cm.rejectInputKey(key));
		}
		const handler = handlers[key];
		return handler ? callback(handler) : undefined;
	};
	return CodeMirror;
}

function createVimCoreLoader(importCore = () => import('@replit/codemirror-vim-core')) {
	let corePromise;
	let preloadStarted = false;

	const load = async () => {
		corePromise ??= Promise.resolve(importCore()).then(({ initVim }) => ({
			CodeMirror: createCodeMirrorShim(),
			createRuntime() {
				const CodeMirror = createCodeMirrorShim();
				return { Vim: initVim(CodeMirror), CodeMirror };
			},
		}));
		return corePromise;
	};
	const preload = () => {
		if (preloadStarted) return Promise.resolve();
		preloadStarted = true;
		return load().catch(() => {
			console.warn('[VIM_MODE] Vim core preload failed');
		});
	};

	return { load, preload };
}

const defaultLoader = createVimCoreLoader();
const loadVimCore = () => defaultLoader.load();
const preloadVimCore = () => { void defaultLoader.preload(); };

function isModifiedShortcut(event) {
	return event.ctrlKey || event.altKey || event.metaKey;
}

function modeOf(adapter) {
	return adapter.state.vim?.insertMode ? 'insert' :
		adapter.state.vim?.visualMode ? 'visual' : 'normal';
}

function isExpectedRejection(error) {
	return error?.name === 'VimEditRejectedError';
}

function cloneRuntimeGraph(value, seen = new WeakMap()) {
	if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
	if (typeof value === 'function') return value;
	if (seen.has(value)) return seen.get(value);
	if (value instanceof Map) {
		const clone = new Map();
		seen.set(value, clone);
		for (const [key, entry] of value) clone.set(cloneRuntimeGraph(key, seen), cloneRuntimeGraph(entry, seen));
		return clone;
	}
	if (value instanceof Set) {
		const clone = new Set();
		seen.set(value, clone);
		for (const entry of value) clone.add(cloneRuntimeGraph(entry, seen));
		return clone;
	}
	const clone = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
	seen.set(value, clone);
	for (const key of Reflect.ownKeys(value)) clone[key] = cloneRuntimeGraph(value[key], seen);
	return clone;
}

function restoreRuntimeGraph(target, snapshot, excludedKeys = new Set()) {
	const seen = new WeakMap([[snapshot, target]]);
	for (const key of Reflect.ownKeys(target)) {
		if (!excludedKeys.has(key)) delete target[key];
	}
	for (const key of Reflect.ownKeys(snapshot)) {
		if (!excludedKeys.has(key)) target[key] = cloneRuntimeGraph(snapshot[key], seen);
	}
}

function createVimDriver(adapter, corePromise = loadVimCore()) {
	return Promise.resolve(corePromise).then(core => {
		const runtime = typeof core.createRuntime === 'function' ? core.createRuntime() : core;
		const { Vim, CodeMirror } = runtime;
		let sequence = [];
		let sequenceMode = null;
		let destroyed = false;
		Vim.enterVimMode?.(adapter);

		const reset = () => { sequence = []; sequenceMode = null; };
		const consume = event => {
			event?.preventDefault?.();
			event?.stopPropagation?.();
		};
		const finish = (tokens, event) => {
			consume(event);
			let transactionStarted = false;
			const vimSnapshot = adapter.snapshotVimState?.();
			const adapterListenerSnapshot = adapter.snapshotListenerTopology?.();
			const domListenerSnapshot = CodeMirror?.snapshotListenerTopology?.();
			const runtimeState = Vim.getVimGlobalState_?.();
			const runtimeSnapshot = runtimeState && cloneRuntimeGraph(runtimeState);
			const repeat = tokens.at(-1) === '.';
			const explicitCharacterActionCount = tokens.at(-1) === 'x' &&
				tokens.every(token => /^\d$/.test(token) || token === 'x') ?
				Number(tokens.slice(0, -1).join('') || 1) : 0;
			const characterMotion = ['h', 'l'].includes(tokens.at(-1)) &&
				tokens.every(token => /^\d$/.test(token) || ['h', 'l'].includes(token)) ? {
				count: Number(tokens.slice(0, -1).join('') || 1), direction: tokens.at(-1),
			} : undefined;
			try {
				adapter.preflightCommand?.();
			adapter.beginCommand?.({ repeat });
				transactionStarted = true;
				if (explicitCharacterActionCount) adapter.setCharacterAction?.(explicitCharacterActionCount);
				if (characterMotion) adapter.setCharacterMotion?.(characterMotion.count, characterMotion.direction);
				for (const token of tokens) {
					const command = Vim.findKey(adapter, token, 'user');
					if (typeof command === 'function') command();
				}
				adapter.commitCommand?.();
				return 'handled';
			} catch (error) {
				try {
					if (transactionStarted) adapter.rollbackCommand?.();
				} finally {
					try {
						adapter.restoreVimState?.(vimSnapshot);
					} finally {
						try {
							if (runtimeState && runtimeSnapshot) {
								if (typeof Vim.resetVimGlobalState_ === 'function') {
									Vim.resetVimGlobalState_();
									const activeRuntimeState = Vim.getVimGlobalState_?.();
									if (activeRuntimeState) restoreRuntimeGraph(activeRuntimeState, runtimeSnapshot, new Set(['jumpList']));
								} else {
									restoreRuntimeGraph(runtimeState, runtimeSnapshot);
								}
							}
						} finally {
							try {
								if (adapterListenerSnapshot && adapter.restoreListenerTopology) {
									adapter.restoreListenerTopology(adapterListenerSnapshot);
								}
							} finally {
								if (domListenerSnapshot && CodeMirror.restoreListenerTopology) {
									CodeMirror.restoreListenerTopology(domListenerSnapshot.slice());
								}
							}
						}
					}
				}
				if (isExpectedRejection(error)) return 'rejected';
				throw error;
			} finally {
				if (explicitCharacterActionCount) adapter.setCharacterAction?.(0);
				if (characterMotion) adapter.setCharacterMotion?.(0);
				reset();
			}
		};

		const isUnmodifiedPrintable = event => !isModifiedShortcut(event) && event.key.length === 1;
		const isUnsupportedNativeMutation = event => !isModifiedShortcut(event) &&
			['Enter', 'Backspace', 'Delete'].includes(event.key);
		const handleNormal = event => {
			const key = event.key;
			if (key === 'Escape' && !isModifiedShortcut(event) && !event.shiftKey) {
				const hadPendingSequence = sequence.length > 0;
				reset();
				return hadPendingSequence ? 'handled' : 'pass-through';
			}
			const exactCtrlR = key === 'r' && event.ctrlKey &&
				!event.altKey && !event.metaKey && !event.shiftKey;
			if (isModifiedShortcut(event) && !exactCtrlR) {
				reset();
				return isUnmodifiedPrintable(event) ? 'rejected' : 'pass-through';
			}
			const token = exactCtrlR ? '<C-r>' : key;

			if (sequence.length === 0) {
				if (token === 'g') {
					sequence = ['g'];
					sequenceMode = 'normal';
					return 'handled';
				}
				if (token >= '1' && token <= '9') {
					sequence = [token];
					sequenceMode = 'normal';
					return 'handled';
				}
				if (OPERATORS.has(token)) {
					sequence = [token];
					sequenceMode = 'normal';
					return 'handled';
				}
				if (NORMAL_KEYS.has(token)) {
					return finish([token], event);
				}
				return isUnsupportedNativeMutation(event) || isUnmodifiedPrintable(event) ? 'rejected' : 'pass-through';
			}

			const first = sequence[0];
			const operatorIndex = sequence.findIndex(tokenValue => OPERATORS.has(tokenValue));
			if (first === 'g' || (operatorIndex === -1 && sequence.at(-1) === 'g')) {
				if (token === 'g') return finish([...sequence, token], event);
				reset();
				return isUnsupportedNativeMutation(event) || isUnmodifiedPrintable(event) ? 'rejected' : 'pass-through';
			}
			if (operatorIndex === -1 && /^[1-9]\d*$/.test(first)) {
				if (/^\d$/.test(token)) {
					sequence.push(token);
					return 'handled';
				}
				if (token === 'g') {
					sequence.push(token);
					return 'handled';
				}
				if (OPERATORS.has(token)) {
					sequence.push(token);
					return 'handled';
				}
				if (NORMAL_KEYS.has(token)) {
					if (token === 'u' || token === '<C-r>') {
						reset();
						return 'rejected';
					}
					return finish([...sequence, token], event);
				}
				reset();
				return isUnsupportedNativeMutation(event) || isUnmodifiedPrintable(event) ? 'rejected' : 'pass-through';
			}

			if (operatorIndex !== -1) {
				const operator = sequence[operatorIndex];
				const afterOperator = sequence.slice(operatorIndex + 1);
				if (afterOperator.at(-1) === 'g') {
					if (token === 'g') return finish([...sequence, token], event);
					reset();
				return isUnsupportedNativeMutation(event) || isUnmodifiedPrintable(event) ? 'rejected' : 'pass-through';
				}
				if (afterOperator.length > 0 && afterOperator.every(value => /^\d$/.test(value))) {
					if (/^\d$/.test(token)) {
						sequence.push(token);
						return 'handled';
					}
				}
				if (afterOperator.length === 0 && /^[1-9]$/.test(token)) {
					sequence.push(token);
					return 'handled';
				}
				if (token === 'g') {
					sequence.push(token);
					return 'handled';
				}
				if (token === operator || (OPERATOR_MOTIONS.has(token) && token !== 'g')) {
					return finish([...sequence, token], event);
				}
			}
			reset();
			return isUnsupportedNativeMutation(event) || isUnmodifiedPrintable(event) ? 'rejected' : 'pass-through';
		};
		const handleKey = event => {
			const mode = modeOf(adapter);
			if (sequence.length > 0 && sequenceMode !== mode) reset();
			const token = event.key === 'Escape' ? '<Esc>' : event.key;
			let outcome;
			if (mode === 'insert') {
				outcome = token === '<Esc>' && !isModifiedShortcut(event) && !event.shiftKey ? finish([token], event) : 'pass-through';
			} else if (mode === 'visual') {
				if (sequence.length === 0 && token === 'g' && !isModifiedShortcut(event)) {
					sequence = ['g'];
					sequenceMode = 'visual';
					outcome = 'handled';
				} else if (sequence.length === 1 && sequence[0] === 'g') {
					if (token === 'g' && !isModifiedShortcut(event)) outcome = finish(['g', 'g'], event);
					else {
						reset();
						outcome = isUnsupportedNativeMutation(event) || isUnmodifiedPrintable(event) ? 'rejected' : 'pass-through';
					}
				} else {
					outcome = (!isModifiedShortcut(event) &&
						((!event.shiftKey && token === '<Esc>') || (OPERATOR_MOTIONS.has(token) && token !== 'g') || OPERATORS.has(token))) ? finish([token], event) :
						(isUnsupportedNativeMutation(event) || isUnmodifiedPrintable(event) ? 'rejected' : 'pass-through');
				}
			} else {
				outcome = handleNormal(event);
			}
			if (outcome === 'handled' || outcome === 'rejected') {
				event.preventDefault?.();
				event.stopPropagation?.();
			}
			return outcome;
		};

		return {
			handleKey,
			mode: () => modeOf(adapter),
			reset,
			resetGrammar: reset,
			destroy() {
				if (destroyed) return;
				destroyed = true;
				reset();
				let firstError;
				try {
					if (adapter.state.vim?.insertMode) {
						delete adapter.state.vim.insertModeRepeat;
						Vim.exitInsertMode?.(adapter, true);
					}
				} catch (error) {
					firstError = error;
				} finally {
					try { Vim.leaveVimMode?.(adapter); } catch (error) { firstError ||= error; }
					try { adapter.destroy?.(); } catch (error) { firstError ||= error; }
				}
				if (firstError) throw firstError;
			},
		};
	});
}

module.exports = {
	loadVimCore, preloadVimCore, createVimCoreLoader, createVimDriver, createCodeMirrorShim,
	cloneRuntimeGraph, restoreRuntimeGraph,
};
