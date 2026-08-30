const { createRichTextPositionMap } = require('./richTextPositionMap');

class VimEditRejectedError extends Error {
	constructor(code, message, cause) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = 'VimEditRejectedError';
		this.code = code;
		if (cause !== undefined) this.cause = cause;
	}
}

class UnsupportedVimAdapterMethodError extends Error {
	constructor(methodName) {
		super(`Unsupported Vim adapter method: ${methodName}`);
		this.name = 'UnsupportedVimAdapterMethodError';
		this.methodName = methodName;
	}
}

class VimRollbackError extends Error {
	constructor(message, cause) {
		super(message, { cause });
		this.name = 'VimRollbackError';
		this.cause = cause;
	}
}

function createRichTextVimAdapter(root, options = {}) {
	if (!(root instanceof Node)) throw new TypeError('root must be a DOM node');

	const document = root.ownerDocument;
	const createPositionMap = options.createPositionMap || createRichTextPositionMap;
	const MutationObserverClass = options.MutationObserverClass || globalThis.MutationObserver;
	const state = {};
	const handlers = new Map();
	let positionMap;
	let dirty = true;
	const placeholderOffsets = new WeakMap();
	const placeholderRecords = new Map();
	const bookmarks = new Set();
	let destroyed = false;
	let transaction;
	let pendingInput;
	let adapter;

	const markDirty = () => {
		dirty = true;
		if (placeholderRecords.size > 0) {
			const currentNodes = snapshotTextNodes();
			for (const [node, record] of placeholderRecords) {
				if (currentNodes.get(node) !== record.value) {
					placeholderRecords.delete(node);
					placeholderOffsets.delete(node);
				}
			}
		}
	};
	const refreshSnapshot = () => {
		if (!dirty && positionMap) return positionMap;
		try {
			positionMap = createPositionMap(root, { placeholderOffsets });
		} catch (error) {
			reject('stale-map', error.message, error);
		}
		dirty = false;
		return positionMap;
	};
	const map = () => refreshSnapshot();
	const logicalText = () => transaction?.virtual?.text ?? map().text;
	const boundaries = () => transaction?.virtual ? [...transaction.virtual.boundaries].sort((a, b) => a - b) :
		[...map().graphemeBoundaries].sort((a, b) => a - b);
	const isBoundary = offset => transaction?.virtual ? transaction.virtual.boundaries.has(offset) : map().graphemeBoundaries.has(offset);
	const posFromOffset = (offset, text = logicalText()) => {
		const lines = text.split('\n');
		let line = 0;
		let remaining = offset;
		while (line < lines.length - 1 && remaining > lines[line].length) {
			remaining -= lines[line].length + 1;
			line += 1;
		}
		return { line, ch: remaining };
	};
	const offsetFromPos = position => {
		const text = logicalText();
		const lines = text.split('\n');
		if (position?.line === lines.length && position.ch === 0) return text.length;
		if (!Number.isInteger(position?.line) || position.line < 0 || position.line >= lines.length) {
			throw new RangeError('line is outside editor');
		}
		if (!Number.isInteger(position.ch) || position.ch < 0 || position.ch > lines[position.line].length) {
			throw new RangeError('column is outside line');
		}
		return lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) + position.ch;
	};
	const isInRoot = node => node === root || root.contains(node);
	const selection = () => document.getSelection();
	const reject = (code, message, cause) => {
		const error = cause instanceof VimEditRejectedError ? cause : new VimEditRejectedError(code, message, cause);
		throw error;
	};
	const currentOffsets = () => {
		if (transaction?.virtual) {
			return {
				anchorOffset: transaction.virtual.anchorOffset,
				headOffset: transaction.virtual.headOffset,
				direction: transaction.virtual.direction,
			};
		}
		const current = selection();
		if (!current || current.rangeCount !== 1 || !isInRoot(current.anchorNode) || !isInRoot(current.focusNode)) {
			reject('stale-selection', 'selection is outside editor');
		}
		try {
			const anchorOffset = map().toOffset(current.anchorNode, current.anchorOffset);
			const headOffset = map().toOffset(current.focusNode, current.focusOffset);
			return {
				anchorOffset,
				headOffset,
				direction: anchorOffset <= headOffset ? 'forward' : 'backward',
				anchorNode: current.anchorNode,
				anchorDomOffset: current.anchorOffset,
				focusNode: current.focusNode,
				focusDomOffset: current.focusOffset,
			};
		} catch (error) {
			reject('stale-selection', error.message, error);
		}
	};
	const snapshotTextNodes = () => {
		const snapshot = new Map();
		const visit = node => {
			if (node.nodeType === Node.TEXT_NODE && typeof node.nodeValue === 'string') {
				snapshot.set(node, node.nodeValue);
				return;
			}
			node.childNodes?.forEach(visit);
		};
		visit(root);
		return snapshot;
	};
	const recordPlaceholderOffsets = (before, diff) => {
		const afterMap = map();
		const insertedEnd = diff.from + diff.inserted.length;
		const after = snapshotTextNodes();
		for (const [node, value] of after) {
			const oldValue = before.get(node);
			const offsets = new Set();
			if (oldValue === undefined || !oldValue.includes('\u00a0')) {
				const segmentStart = afterMap.segments.find(segment => segment.node === node)?.start;
				if (segmentStart === undefined) continue;
				let prefix = 0;
				while (oldValue !== undefined && prefix < oldValue.length && prefix < value.length && oldValue[prefix] === value[prefix]) prefix += 1;
				let suffix = 0;
				while (oldValue !== undefined && suffix < oldValue.length - prefix && suffix < value.length - prefix &&
					oldValue[oldValue.length - suffix - 1] === value[value.length - suffix - 1]) suffix += 1;
				for (let offset = prefix; offset < value.length - suffix; offset += 1) {
					if (value[offset] === '\u00a0' && segmentStart + offset >= diff.from && segmentStart + offset < insertedEnd) {
						offsets.add(offset);
					}
				}
			}
			if (offsets.size) {
				placeholderOffsets.set(node, offsets);
				placeholderRecords.set(node, { value, offsets });
			}
		}
	};
	const domPoint = (offset, bias) => map().toDomPoint(offset, bias);
	const setDomSelection = (anchorOffset, headOffset, direction) => {
		const current = selection();
		if (anchorOffset === headOffset) {
			const collapsed = domPoint(anchorOffset, direction === 'backward' ? 'backward' : 'forward');
			root.focus?.();
			current.setBaseAndExtent?.(collapsed.node, collapsed.offset, collapsed.node, collapsed.offset);
			return;
		}
		const anchorBias = direction === 'backward' ? 'backward' : 'forward';
		const headBias = direction === 'backward' ? 'forward' : 'backward';
		const anchor = domPoint(anchorOffset, anchorBias);
		const head = domPoint(headOffset, headBias);
		root.focus?.();
		if (typeof current.setBaseAndExtent === 'function') {
			current.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
			return;
		}
		const range = document.createRange();
		range.setStart(anchor.node, anchor.offset);
		range.setEnd(head.node, head.offset);
		current.removeAllRanges();
		current.addRange(range);
	};
	const commonPrefix = (before, after, limit) => {
		let offset = 0;
		while (offset < limit && before[offset] === after[offset]) offset += 1;
		return offset;
	};
	const textDiff = (before, after) => {
		const from = commonPrefix(before, after, Math.min(before.length, after.length));
		let suffix = 0;
		while (suffix < before.length - from && suffix < after.length - from &&
			before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix += 1;
		return {
			from,
			to: before.length - suffix,
			inserted: after.slice(from, after.length - suffix),
		};
	};
	const virtualState = (text, anchorOffset, headOffset, direction) => {
		const virtualBoundaries = new Set([0, text.length]);
		for (const boundary of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
			virtualBoundaries.add(boundary.index);
		}
		return { text, anchorOffset, headOffset, direction, boundaries: virtualBoundaries };
	};
	const applyTextDiff = (before, after) => {
		const diff = textDiff(before, after);
		if (diff.from !== diff.to || diff.inserted) applyBookmarkChange(diff.from, diff.to, diff.inserted.length);
		return diff;
	};
	const applyBookmarkChange = (from, to, insertedLength) => {
		const delta = insertedLength - (to - from);
		for (const bookmark of bookmarks) {
			if (bookmark.cleared) continue;
			if (bookmark.offset > to) bookmark.offset += delta;
			else if (bookmark.offset >= from && bookmark.offset <= to) bookmark.offset = from + insertedLength;
			try { bookmark.point = map().toDomPoint(bookmark.offset, 'forward'); } catch { bookmark.point = null; }
		}
	};
	const emitNativeChange = event => {
		markDirty();
		if (event?.type !== 'input') return;
		const before = pendingInput;
		pendingInput = null;
		if (!before) return;
		if (transaction?.adapterMutation) return;
		const after = map().text;
		const { from, to, inserted } = applyTextDiff(before.text, after);
		const inputType = before.inputType;
		const origin = inputType === 'historyUndo' ? '*undo' : inputType === 'historyRedo' ? '*redo' : '+input';
		adapter?.signal('change', adapter, {
			from: posFromOffset(from, before.text),
			to: posFromOffset(to, before.text),
			text: inputType?.startsWith('delete') ? [''] : [inserted],
			origin,
		});
	};
	const captureNativeInput = event => {
		try {
			const current = currentOffsets();
			pendingInput = {
				text: map().text,
				start: Math.min(current.anchorOffset, current.headOffset),
				end: Math.max(current.anchorOffset, current.headOffset),
				inputType: event?.inputType,
				data: event?.data,
			};
		} catch (error) {
			pendingInput = null;
			if (!(error instanceof VimEditRejectedError)) reject('stale-selection', error.message, error);
		}
	};
	const stateFromPosition = position => {
		try {
			const target = offsetFromPos(position);
			if (!isBoundary(target)) reject('grapheme-boundary', 'position splits a grapheme');
			return target;
		} catch (error) {
			if (error instanceof VimEditRejectedError) throw error;
			reject('invalid-endpoint', error.message, error);
		}
	};
	const cloneVimState = (value, seen = new WeakMap()) => {
		if (value === null || typeof value !== 'object') return value;
		if (typeof value.find === 'function' && typeof value.clear === 'function') return value;
		if (seen.has(value)) return seen.get(value);
		const clone = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
		seen.set(value, clone);
		Reflect.ownKeys(value).forEach(key => {
			clone[key] = cloneVimState(value[key], seen);
		});
		return clone;
	};
	const restoreVimState = checkpoint => {
		if (!checkpoint) return;
		const rootSnapshot = checkpoint.values ?? checkpoint;
		const root = checkpoint.root ?? state.vim;
		const seen = new WeakMap([[rootSnapshot, root]]);
		for (const key of Reflect.ownKeys(root)) delete root[key];
		for (const key of Reflect.ownKeys(rootSnapshot)) root[key] = cloneVimState(rootSnapshot[key], seen);
		state.vim = root;
	};
	const normalizeOffset = (offset, direction) => {
		if (isBoundary(offset)) return offset;
		const sorted = boundaries();
		const next = sorted.find(boundary => boundary > offset);
		const previous = [...sorted].reverse().find(boundary => boundary < offset);
		const normalized = direction === 'forward' ? next : previous;
		if (normalized === undefined) reject('grapheme-boundary', 'position has no grapheme boundary');
		return normalized;
	};
	const normalizedPosition = (position, direction) => {
		const offset = normalizeOffset(offsetFromPos(position), direction);
		return posFromOffset(offset);
	};
	const characterActionRange = (from, to, count) => {
		const start = offsetFromPos(from);
		const end = offsetFromPos(to);
		const lines = logicalText().split('\n');
		const startLine = posFromOffset(start).line;
		if (startLine !== posFromOffset(end).line) return { from, to };
		const lineStart = lines.slice(0, startLine).reduce((total, line) => total + line.length + 1, 0);
		const lineEnd = lineStart + lines[startLine].length;
		const sorted = boundaries().filter(boundary => boundary >= start && boundary <= lineEnd);
		const index = sorted.indexOf(start);
		if (index < 0) reject('grapheme-boundary', 'character action starts inside a grapheme');
		const target = sorted[Math.min(index + count, sorted.length - 1)];
		return { from: posFromOffset(start), to: posFromOffset(Math.max(end, target)) };
	};
	const currentRange = () => {
		const current = currentOffsets();
		return {
			start: Math.min(current.anchorOffset, current.headOffset),
			end: Math.max(current.anchorOffset, current.headOffset),
			...current,
		};
	};
	const assertNoAtomicRange = (start, end) => {
		try {
			if (map().crossesAtomic(start, end)) reject('atomic-crossing', 'range crosses an atomic element');
		} catch (error) {
			if (error instanceof VimEditRejectedError) throw error;
			reject('atomic-boundary', error.message, error);
		}
	};
	const assertNoVirtualAtomicRange = (start, end) => {
		for (let offset = Math.min(start, end); offset < Math.max(start, end); offset += 1) {
			if (logicalText()[offset] === '\uFFFC') reject('atomic-crossing', 'range crosses an atomic element');
		}
	};
	const preflightRange = (from, to) => {
		const current = currentOffsets();
		const start = stateFromPosition(from);
		const end = stateFromPosition(to);
		if (start > end) reject('unordered-range', 'replacement range is unordered');
		if (transaction?.virtual) assertNoVirtualAtomicRange(start, end);
		else assertNoAtomicRange(start, end);
		return { current, start, end };
	};
	const refreshAfterNative = (cause) => {
		markDirty();
		try {
			refreshSnapshot();
		} catch (error) {
			reject('stale-map', error.message, cause || error);
		}
	};
	const invokeNative = (command, value, inverseCommand) => {
		if (transaction && transaction.nativeAttempts > 0) {
			reject('multiple-native-edits', 'Vim command attempted more than one native edit');
		}
		if (transaction) {
			transaction.nativeAttempts += 1;
			transaction.inverseCommand = inverseCommand;
		}
		const beforeHTML = root.innerHTML;
		const beforeText = map().text;
		const beforeTextNodes = snapshotTextNodes();
		let result;
		let nativeError;
		if (transaction) transaction.adapterMutation = true;
		try {
			result = document.execCommand(command, false, value);
		} catch (error) {
			nativeError = error;
		} finally {
			if (transaction) transaction.adapterMutation = false;
		}
		const actualMutation = root.innerHTML !== beforeHTML;
		const canRecordPlaceholder = command === 'delete' || (command === 'insertText' && value === '');
		if (transaction && actualMutation && canRecordPlaceholder) {
			transaction.beforeTextNodes = beforeTextNodes;
			transaction.pendingPlaceholderRecord = true;
		}
		if (transaction && actualMutation) transaction.mutated = true;
		try {
			refreshAfterNative(nativeError);
			if (actualMutation) {
				const diff = applyTextDiff(beforeText, map().text);
				if (transaction?.pendingPlaceholderRecord) transaction.placeholderDiff = diff;
			}
		} catch (error) {
			if (nativeError) throw nativeError;
			throw error;
		}
		if (nativeError) throw nativeError;
		if (!result) reject('exec-command', 'native edit command rejected');
		return { result, actualMutation };
	};
	const applyReplacement = (from, to, replacement) => {
		if (typeof replacement !== 'string') throw new TypeError('replacement must be a string');
		if (replacement.includes('\uFFFC')) reject('atomic-sentinel', 'replacement contains an atomic sentinel');
		const plan = preflightRange(from, to);
		if (replacement === '' && plan.start === plan.end) return true;
		const direction = plan.current.direction;
		if (transaction?.virtual) {
			const before = transaction.virtual.text;
			const changedSpan = transaction.virtual.changedSpan;
			const nextText = before.slice(0, plan.start) + replacement + before.slice(plan.end);
			let nextChangedSpan;
			if (changedSpan) {
				if (plan.end < changedSpan.start || plan.start > changedSpan.end) {
					reject('multiple-native-edits', 'Vim repeat touched disjoint ranges');
				}
			}
			const diff = textDiff(transaction.initialText, nextText);
			const cancelled = diff.from === diff.to && diff.inserted === '' && nextText === transaction.initialText;
			const point = Math.min(plan.start + replacement.length, nextText.length);
			nextChangedSpan = cancelled ? { start: point, end: point } :
				{ start: diff.from, end: diff.from + diff.inserted.length };
			const nextVirtual = virtualState(
				nextText,
				plan.start + replacement.length, plan.start + replacement.length, direction);
			nextVirtual.changedSpan = nextChangedSpan;
			transaction.virtual = nextVirtual;
			return true;
		}
		if (transaction?.repeat) {
			const last = transaction.replacements.at(-1);
			if (last && (last.start !== plan.start || last.end !== plan.end)) {
				reject('multiple-native-edits', 'Vim repeat cannot be collapsed into one replacement');
			}
			transaction.replacements.push({ start: plan.start, end: plan.end, replacement });
			return true;
		}
		if (transaction?.characterActionCount) transaction.characterActionStart = plan.start;
		try {
			setDomSelection(plan.start, plan.end, plan.start === plan.end ? direction : 'forward');
		} catch (error) {
			if (error instanceof VimEditRejectedError) throw error;
			reject('invalid-endpoint', error.message, error);
		}
		const command = replacement === '' ? 'delete' : 'insertText';
		return invokeNative(command, replacement, 'undo').result;
	};
	const deleteLogical = direction => {
		const current = currentRange();
		if (current.start !== current.end) {
			applyReplacement(posFromOffset(current.start), posFromOffset(current.end), '');
			return;
		}
		const sorted = boundaries();
		const index = sorted.indexOf(current.headOffset);
		const target = direction === 'backward' ? sorted[index - 1] : sorted[index + 1];
		if (target === undefined) return;
		const start = direction === 'backward' ? target : current.headOffset;
		const end = direction === 'backward' ? current.headOffset : target;
		applyReplacement(posFromOffset(start), posFromOffset(end), '');
	};
	const restoreSelectionState = saved => {
		if (!saved) return;
		if (saved.anchorNode && saved.focusNode && isInRoot(saved.anchorNode) && isInRoot(saved.focusNode)) {
			root.focus?.();
			selection().setBaseAndExtent?.(
				saved.anchorNode, saved.anchorDomOffset, saved.focusNode, saved.focusDomOffset);
			return;
		}
		setDomSelection(saved.anchorOffset, saved.headOffset, saved.direction);
	};
	const restoreBookmarkState = snapshots => {
		for (const snapshot of snapshots || []) {
			snapshot.bookmark.offset = snapshot.offset;
			snapshot.bookmark.cleared = snapshot.cleared;
			if (snapshot.cleared) {
				bookmarks.delete(snapshot.bookmark);
				snapshot.bookmark.point = null;
				continue;
			}
			bookmarks.add(snapshot.bookmark);
			try {
				snapshot.bookmark.point = map().toDomPoint(snapshot.offset, 'forward');
			} catch {
				snapshot.bookmark.point = null;
			}
		}
	};
	const rollback = () => {
		if (!transaction) return;
		const current = transaction;
		transaction = null;
		try {
			if (current.mutated) {
				const beforeHTML = root.innerHTML;
				let result;
				let nativeError;
				try {
					result = document.execCommand(current.inverseCommand, false, '');
				} catch (error) {
					nativeError = error;
				}
				const actualMutation = root.innerHTML !== beforeHTML;
				markDirty();
				try { refreshSnapshot(); } catch (error) { throw new Error('rollback map rebuild failed', { cause: error }); }
				if (nativeError) throw nativeError;
				if (!result || !actualMutation || root.innerHTML !== current.html) {
					throw new Error('native undo did not restore exact HTML');
				}
			}
			restoreBookmarkState(current.bookmarks);
			restoreSelectionState(current.selection);
		} catch (error) {
			throw new VimRollbackError('Vim command rollback failed', error);
		} finally {
			state.overwrite = current.overwrite;
			Object.keys(options).forEach(name => delete options[name]);
			Object.assign(options, current.options);
		}
	};
	const listeners = [
		[root, 'beforeinput'], [root, 'input'], [document, 'selectionchange'],
	].filter(([target]) => typeof target?.addEventListener === 'function');
	listeners.forEach(entry => {
		const [target, type] = entry;
		const emitSelectionChange = () => {
			markDirty();
			const current = document.getSelection?.();
			if (!current || current.rangeCount !== 1 || !isInRoot(current.anchorNode) || !isInRoot(current.focusNode)) return;
			adapter?.signal('cursorActivity', adapter);
		};
		const listener = type === 'selectionchange' ? emitSelectionChange :
			type === 'beforeinput' ? captureNativeInput : emitNativeChange;
		entry.push(listener);
		target.addEventListener(type, listener);
	});
	const observer = typeof MutationObserverClass === 'function' ? new MutationObserverClass(markDirty) : null;
	observer?.observe(root, { attributes: true, childList: true, characterData: true, subtree: true });

	adapter = {
		state,
		snapshotVimState: () => ({ root: state.vim, values: cloneVimState(state.vim) }),
		restoreVimState,
		marks: {},
		$mid: {},
		curOp: {},
		options: { ...options },
		_handlers: handlers,
		refreshSnapshot,
		preflightCommand() { return currentOffsets(); },
		beginCommand(commandOptions = {}) {
			if (transaction) throw new Error('Vim command transaction already active');
			transaction = {
				html: root.innerHTML,
				initialText: map().text,
				overwrite: state.overwrite,
				options: { ...options },
				selection: currentOffsets(),
				nativeAttempts: 0,
				mutated: false,
				inverseCommand: 'undo',
				beforeTextNodes: null,
				placeholderDiff: null,
				pendingPlaceholderRecord: false,
				bookmarks: [...bookmarks].map(bookmark => ({
					bookmark,
					offset: bookmark.offset,
					cleared: bookmark.cleared,
				})),
				repeat: commandOptions.repeat === true,
				replacements: [],
			};
			if (commandOptions.repeat === true) {
				transaction.virtual = virtualState(
					map().text, transaction.selection.anchorOffset, transaction.selection.headOffset,
					transaction.selection.direction);
				transaction.virtual.changedSpan = null;
			}
		},
		commitCommand() {
			if (!transaction) return;
			if (transaction.virtual) {
				const current = transaction;
				const finalVirtual = current.virtual;
				transaction.virtual = null;
				transaction.repeat = false;
				const diff = textDiff(current.initialText, finalVirtual.text);
				if (diff.from !== diff.to || diff.inserted) {
					applyReplacement(posFromOffset(diff.from), posFromOffset(diff.to), diff.inserted);
				}
				setDomSelection(finalVirtual.anchorOffset, finalVirtual.headOffset, finalVirtual.direction);
			}
			if (transaction.repeat && transaction.replacements.length > 0) {
				const [first] = transaction.replacements;
				const replacement = transaction.replacements.map(({ replacement: value }) => value).join('');
				transaction.repeat = false;
				applyReplacement(posFromOffset(first.start), posFromOffset(first.end), replacement);
			}
			refreshSnapshot();
			if (transaction.pendingPlaceholderRecord) {
				recordPlaceholderOffsets(transaction.beforeTextNodes, transaction.placeholderDiff);
				markDirty();
				refreshSnapshot();
			}
			if (transaction.characterActionStart !== undefined) {
				setDomSelection(transaction.characterActionStart, transaction.characterActionStart, 'forward');
			}
			transaction = null;
		},
		rollbackCommand: rollback,
		destroy() {
			if (destroyed) return;
			destroyed = true;
			listeners.forEach(([target, type, listener]) => target.removeEventListener(type, listener));
			observer?.disconnect();
			handlers.clear();
			transaction = null;
		},
		getSelectionState() {
			const current = currentOffsets();
			return { anchorOffset: current.anchorOffset, headOffset: current.headOffset, direction: current.direction };
		},
		indexFromPos: offsetFromPos,
		posFromIndex: posFromOffset,
		firstLine: () => 0,
		lastLine: () => logicalText().split('\n').length - 1,
		lineCount: () => logicalText().split('\n').length,
		getLine: line => logicalText().split('\n')[line],
		getRange(from, to) {
			const start = offsetFromPos(this.clipPos(from));
			const end = offsetFromPos(this.clipPos(to));
			if (transaction?.virtual) assertNoVirtualAtomicRange(Math.min(start, end), Math.max(start, end));
			else assertNoAtomicRange(Math.min(start, end), Math.max(start, end));
			return logicalText().slice(start, end);
		},
		getValue: () => logicalText(),
		clipPos(position) {
			const lines = logicalText().split('\n');
			if (position?.line === lines.length && position.ch === 0) return { line: lines.length, ch: 0 };
			const line = Math.max(0, Math.min(lines.length - 1, position?.line ?? 0));
			const requestedCh = Number.isFinite(position?.ch) ? position.ch : lines[line].length;
			const ch = Math.max(0, Math.min(lines[line].length, requestedCh));
			return { line, ch };
		},
		getCursor(which = 'head') {
			const current = currentOffsets();
			const offsets = {
				anchor: current.anchorOffset,
				head: current.headOffset,
				start: Math.min(current.anchorOffset, current.headOffset),
				end: Math.max(current.anchorOffset, current.headOffset),
			};
			if (!(which in offsets)) throw new TypeError(`unknown cursor endpoint: ${which}`);
			return posFromOffset(offsets[which]);
		},
		getCursorVisual() {
			const current = currentOffsets();
			if (current.anchorOffset !== current.headOffset || transaction?.virtual) return null;
			const startOffset = current.headOffset;
			const nextOffset = boundaries().find(boundary => boundary > startOffset);
			const text = nextOffset === undefined ? '' : logicalText().slice(startOffset, nextOffset);
			const atLineEnd = !text || text.includes('\n');
			const endOffset = atLineEnd ? startOffset : nextOffset;
			const start = domPoint(startOffset, 'forward');
			const end = domPoint(endOffset, atLineEnd ? 'forward' : 'backward');
			const range = document.createRange();
			range.setStart(start.node, start.offset);
			range.setEnd(end.node, end.offset);
			let rect = range.getBoundingClientRect();
			if (!logicalText() && rect.width === 0 && rect.height === 0) {
				const rootRect = root.getBoundingClientRect?.();
				const style = document.defaultView?.getComputedStyle?.(root);
				if (rootRect && style) {
					const pixels = value => Number.parseFloat(value) || 0;
					const fontSize = pixels(style.fontSize) || 16;
					const lineHeight = pixels(style.lineHeight) || fontSize * 1.2;
					const left = rootRect.left + pixels(style.borderLeftWidth) + pixels(style.paddingLeft);
					const top = rootRect.top + pixels(style.borderTopWidth) + pixels(style.paddingTop);
					rect = { left, top, right: left, bottom: top + lineHeight, width: 0, height: lineHeight };
				}
			}
			return {
				text: atLineEnd ? '' : text,
				atLineEnd,
				rect: {
					left: rect.left,
					top: rect.top,
					right: rect.right,
					bottom: rect.bottom,
					width: rect.width,
					height: rect.height,
				},
			};
		},
		listSelections() {
			const current = currentOffsets();
			return [{ anchor: posFromOffset(current.anchorOffset), head: posFromOffset(current.headOffset) }];
		},
		setCursor(position, ch) {
			try {
				const requested = typeof position === 'number' ? { line: position, ch } : position;
				const current = currentOffsets();
				if (transaction?.characterMotion) {
					const lines = logicalText().split('\n');
					const currentPosition = posFromOffset(current.headOffset);
					const lineStart = lines.slice(0, currentPosition.line)
						.reduce((total, lineValue) => total + lineValue.length + 1, 0);
					const lineEnd = lineStart + lines[currentPosition.line].length;
					const sorted = boundaries().filter(boundary => boundary >= lineStart && boundary < lineEnd);
					if (sorted.length === 0) sorted.push(lineStart);
					const index = sorted.indexOf(current.headOffset) < 0 && current.headOffset === lineEnd ?
						sorted.length : sorted.indexOf(current.headOffset);
					if (index < 0) reject('grapheme-boundary', 'horizontal movement has no grapheme position');
					const amount = transaction.characterMotion.direction === 'l' ?
						transaction.characterMotion.count : -transaction.characterMotion.count;
					const target = sorted[Math.max(0, Math.min(sorted.length - 1, index + amount))];
					transaction.characterMotion = undefined;
					if (transaction?.virtual) {
						transaction.virtual.anchorOffset = target;
						transaction.virtual.headOffset = target;
						transaction.virtual.direction = amount >= 0 ? 'forward' : 'backward';
					} else setDomSelection(target, target, amount >= 0 ? 'forward' : 'backward');
					return;
				}
				const clipped = this.clipPos(requested);
				const requestedOffset = offsetFromPos(clipped);
				const direction = requestedOffset >= current.headOffset ? 'forward' : 'backward';
				const target = stateFromPosition(normalizedPosition(clipped, direction));
				if (transaction?.virtual) {
					transaction.virtual.anchorOffset = target;
					transaction.virtual.headOffset = target;
					transaction.virtual.direction = direction;
				} else setDomSelection(target, target, direction);
			} catch (error) {
				if (error instanceof VimEditRejectedError) throw error;
				reject('invalid-endpoint', error.message, error);
			}
		},
		setSelection(anchor, head) {
			try {
				const clippedAnchor = this.clipPos(anchor);
				const clippedHead = this.clipPos(head);
				const requestedAnchor = offsetFromPos(clippedAnchor);
				const requestedHead = offsetFromPos(clippedHead);
				const direction = requestedAnchor <= requestedHead ? 'forward' : 'backward';
				const anchorOffset = stateFromPosition(normalizedPosition(clippedAnchor,
					direction === 'forward' ? 'backward' : 'forward'));
					const headOffset = stateFromPosition(normalizedPosition(clippedHead,
						direction === 'forward' ? 'forward' : 'backward'));
					if (transaction?.virtual) assertNoVirtualAtomicRange(anchorOffset, headOffset);
					else assertNoAtomicRange(anchorOffset, headOffset);
				if (transaction?.virtual) {
					transaction.virtual.anchorOffset = anchorOffset;
					transaction.virtual.headOffset = headOffset;
					transaction.virtual.direction = anchorOffset <= headOffset ? 'forward' : 'backward';
				} else setDomSelection(anchorOffset, headOffset, anchorOffset <= headOffset ? 'forward' : 'backward');
			} catch (error) {
				if (error instanceof VimEditRejectedError) throw error;
				reject('invalid-endpoint', error.message, error);
			}
		},
		setSelections(nextSelections) {
			if (!Array.isArray(nextSelections) || nextSelections.length !== 1) {
				throw new UnsupportedVimAdapterMethodError('setSelections');
			}
			this.setSelection(nextSelections[0].anchor, nextSelections[0].head);
		},
		setCharacterAction(count) {
			if (!transaction) return;
			if (!Number.isInteger(count) || count < 0) throw new TypeError('character action count must be non-negative');
			transaction.characterActionCount = count;
		},
		setCharacterMotion(count, direction) {
			if (!transaction) return;
			if (count === 0) {
				transaction.characterMotion = undefined;
				return;
			}
			if (!Number.isInteger(count) || count < 1 || !['h', 'l'].includes(direction)) {
				throw new TypeError('character motion must have a positive count and h/l direction');
			}
			transaction.characterMotion = { count, direction };
		},
		getSelection() {
			const current = currentRange();
			if (transaction?.virtual) assertNoVirtualAtomicRange(current.start, current.end);
			else assertNoAtomicRange(current.start, current.end);
			return logicalText().slice(current.start, current.end);
		},
		getSelections() { return [this.getSelection()]; },
		somethingSelected: () => {
			const current = currentOffsets();
			return current.anchorOffset !== current.headOffset;
		},
		replaceRange(text, from, to) {
			const start = from || this.getCursor();
			const end = to || start;
			try {
				const clippedStart = this.clipPos(start);
				const clippedEnd = this.clipPos(end);
				const range = text === '' && transaction?.characterActionCount ?
					characterActionRange(clippedStart, clippedEnd, transaction.characterActionCount) :
					{ from: clippedStart, to: clippedEnd };
				return applyReplacement(range.from, range.to, text);
			} catch (error) {
				if (error instanceof VimEditRejectedError) throw error;
				reject('invalid-endpoint', error.message, error);
			}
		},
		replaceSelection(text) {
			const current = currentRange();
			return applyReplacement(posFromOffset(current.start), posFromOffset(current.end), text);
		},
		replaceSelections(replacements) {
		if (!Array.isArray(replacements) || replacements.length !== 1) {
			throw new UnsupportedVimAdapterMethodError('replaceSelections');
		}
		return this.replaceSelection(replacements[0]);
	},
		deleteBackward() { deleteLogical('backward'); },
		deleteForward() { deleteLogical('forward'); },
		rejectInputKey(key) { reject('unsupported-input-key', `modified ${key} cannot be replayed safely`); },
		getInputField() { return root; },
		focus() { root.focus?.(); },
		blur() { root.blur?.(); },
		moveH(amount) {
			const current = currentOffsets();
			const lines = logicalText().split('\n');
			const currentPosition = posFromOffset(current.headOffset);
			const lineStart = lines.slice(0, currentPosition.line)
				.reduce((total, lineValue) => total + lineValue.length + 1, 0);
			const lineEnd = lineStart + lines[currentPosition.line].length;
			const sorted = boundaries().filter(boundary => boundary >= lineStart && boundary < lineEnd);
			if (sorted.length === 0) sorted.push(lineStart);
			const index = sorted.indexOf(current.headOffset) < 0 && current.headOffset === lineEnd ?
				sorted.length : sorted.indexOf(current.headOffset);
			if (index < 0 || !Number.isInteger(amount)) reject('grapheme-boundary', 'horizontal movement has no grapheme position');
			const targetIndex = Math.max(0, Math.min(sorted.length - 1, index + amount));
			const next = sorted[targetIndex];
			this.setCursor(posFromOffset(next));
		},
		setBookmark(position) {
			const bookmark = {
				cleared: false,
				offset: stateFromPosition(this.clipPos(position)),
				find: () => {
					if (bookmark.cleared) return null;
					if (transaction?.virtual) return posFromOffset(bookmark.offset);
					if (!bookmark.point || !isInRoot(bookmark.point.node)) return null;
					try {
						const point = map().toDomPoint(bookmark.offset, 'forward');
						return isInRoot(point.node) ? posFromOffset(bookmark.offset) : null;
					} catch { return null; }
				},
				clear: () => {
					bookmark.cleared = true;
					bookmark.point = null;
					bookmarks.delete(bookmark);
				},
				update: (node, offset) => {
					if (!bookmark.cleared) {
						if (transaction?.virtual) bookmark.offset = transaction.virtual.headOffset;
						else {
							bookmark.offset = map().toOffset(node, offset);
							bookmark.point = { node, offset };
						}
					}
				},
			};
			if (!transaction?.virtual) bookmark.point = map().toDomPoint(bookmark.offset, 'forward');
			bookmarks.add(bookmark);
			return bookmark;
			},
		/** Returns the number of live bookmarks for adapter diagnostics and tests. */
		activeBookmarkCount: () => bookmarks.size,
		getLineHandle: line => ({ line }),
		getLineNumber: handle => handle.line,
		releaseLineHandles() {},
		execCommand(command) {
			if (command !== 'undo' && command !== 'redo') {
				throw new UnsupportedVimAdapterMethodError(`execCommand:${command}`);
			}
			return invokeNative(command, '', command === 'undo' ? 'redo' : 'undo').result;
		},
		findPosV(position, amount, unit = 'line', goalColumn) {
			void unit;
			const lines = logicalText().split('\n');
			const line = Math.max(0, Math.min(lines.length - 1, position.line + amount));
			const requestedCh = goalColumn === undefined ? position.ch : goalColumn;
			const ch = Math.max(0, Math.min(lines[line].length, requestedCh));
			const direction = amount >= 0 ? 'forward' : 'backward';
			return normalizedPosition({ line, ch }, direction);
		},
		charCoords(position) {
			const clipped = this.clipPos(position);
			const normalized = normalizedPosition(clipped, 'forward');
			return { left: normalized.ch, right: normalized.ch, top: normalized.line, bottom: normalized.line + 1 };
		},
		coordsChar(coords) {
			const line = Math.max(0, Math.min(this.lastLine(), Math.floor(coords.top ?? 0)));
			const ch = Math.max(0, Math.min(this.getLine(line).length, Math.round(coords.left ?? 0)));
			return normalizedPosition({ line, ch }, 'backward');
		},
		defaultTextHeight: () => 1,
		getLastEditEnd: () => undefined,
		scrollIntoView() {},
		getOption: name => name === 'firstLineNumber' ? (options[name] ?? 1) : options[name],
		setOption(name, value) { options[name] = value; },
		toggleOverwrite(value) { state.overwrite = value === undefined ? !state.overwrite : value; },
		getTokenTypeAt: () => null,
		on(type, listener) {
			const current = handlers.get(type) || new Set();
			current.add(listener);
			handlers.set(type, current);
		},
		off(type, listener) { handlers.get(type)?.delete(listener); },
		snapshotListenerTopology() {
			return new Map([...handlers].map(([type, listeners]) => [type, new Set(listeners)]));
		},
		restoreListenerTopology(snapshot) {
			handlers.clear();
			for (const [type, listeners] of snapshot || []) handlers.set(type, new Set(listeners));
		},
		signal(type, ...args) {
			handlers.get(type)?.forEach(listener => {
				if (type === 'change' && listener.length < 2) listener(args.at(-1));
				else listener(...args);
			});
		},
		operation: callback => callback(),
		onBeforeEndOperation() {},
		openNotification() {},
	};

	return new Proxy(adapter, {
		get(target, property, receiver) {
			if (property in target) return Reflect.get(target, property, receiver);
			if (typeof property === 'symbol') return undefined;
			return () => { throw new UnsupportedVimAdapterMethodError(property); };
		},
	});
}

module.exports = {
	createRichTextVimAdapter,
	VimEditRejectedError,
	UnsupportedVimAdapterMethodError,
	VimRollbackError,
};
