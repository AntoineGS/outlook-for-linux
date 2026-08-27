const ATOMIC_SELECTOR = [
	'[contenteditable="false"]', '[role="img"]', '[data-attachment-id]',
	'[data-attachment]', '[data-mention-id]', '[data-widget]', '[data-outlook-widget]',
	'img', 'svg', 'video', 'audio', 'canvas', 'object', 'embed', 'iframe',
].join(',');

const INLINE_TAGS = new Set([
	'A', 'B', 'BDI', 'BDO', 'CITE', 'CODE', 'DEL', 'EM', 'I', 'INS', 'KBD',
	'MARK', 'Q', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U',
]);
const BLOCK_TAGS = new Set(['BLOCKQUOTE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'P', 'PRE']);
const TRANSPARENT_TAGS = new Set([...INLINE_TAGS, ...BLOCK_TAGS, 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN']);

function createRichTextPositionMap(root, options = {}) {
	if (!(root instanceof Node)) throw new TypeError('root must be a DOM node');

	const segments = [];
	const textParts = [];
	const atomicNodes = [];
	const emptyBlockOffsets = new Map();
	let text = '';
	const point = (node, offset) => ({ node, offset });
	const append = (value, node, startPoint, endPoint, atomic = false, boundary = {}) => {
		if (!value) return;
		const start = text.length;
		text += value;
		segments.push({ start, end: text.length, node, atomic, startPoint, endPoint, ...boundary });
		if (atomic) atomicNodes.push(node);
	};
	const isKnownAtomic = node => node.matches(ATOMIC_SELECTOR);
	const isAtomic = node => isKnownAtomic(node) ||
		(node !== root && node.nodeName !== 'BR' && !TRANSPARENT_TAGS.has(node.nodeName));
	const classify = node => {
		if (node.nodeType === Node.TEXT_NODE) return { projects: node.nodeValue.length > 0, block: false };
		if (node.nodeType !== Node.ELEMENT_NODE) return { projects: false, block: false };
		if (node.nodeName === 'BR' || isAtomic(node)) {
			return { projects: true, block: BLOCK_TAGS.has(node.nodeName) };
		}
		return {
			projects: BLOCK_TAGS.has(node.nodeName) || [...node.childNodes].some(child => classify(child).projects),
			block: BLOCK_TAGS.has(node.nodeName),
		};
	};
	const isStructuralPlaceholderBreak = node => {
		if (node.nodeName !== 'BR' || !BLOCK_TAGS.has(node.parentNode?.nodeName)) return false;
		return [...node.parentNode.childNodes]
			.filter(sibling => sibling !== node)
			.every(sibling => !classify(sibling).projects);
	};
	const projectChildren = parent => {
		const projectedChildren = [...parent.childNodes]
			.map((child, rawIndex) => ({ child, rawIndex, ...classify(child) }))
			.filter(child => child.projects);
		let previous;
		projectedChildren.forEach(current => {
			const childSegments = previous && segments.slice(previous.beforeSegments);
			const previousEndsWithBreak = childSegments?.at(-1)?.node.nodeName === 'BR';
			if (previous && (previous.block || current.block) && !previousEndsWithBreak) {
				const startPoint = childSegments.at(-1)?.endPoint ||
					point(previous.child, previous.child.childNodes.length);
				append('\n', previous.child, startPoint, point(current.child, 0));
			}
			current.beforeSegments = segments.length;
			project(current.child);
			previous = current;
		});
	};
	const project = node => {
		if (node.nodeType === Node.TEXT_NODE) {
			const ignoredOffsets = options.placeholderOffsets?.get(node) || new Set();
			let runStart;
			for (let sourceOffset = 0; sourceOffset <= node.nodeValue.length; sourceOffset += 1) {
				const ignored = ignoredOffsets.has(sourceOffset);
				if (runStart === undefined && sourceOffset < node.nodeValue.length && !ignored) runStart = sourceOffset;
				if (runStart === undefined || (sourceOffset < node.nodeValue.length && !ignored)) continue;
				const sourceEnd = sourceOffset;
				const value = node.nodeValue.slice(runStart, sourceEnd);
				let forwardEnd = sourceEnd;
				while (ignoredOffsets.has(forwardEnd)) forwardEnd += 1;
				append(value, node, point(node, runStart), point(node, sourceEnd), false, {
					sourceStart: runStart,
					sourceEnd,
					forwardStart: runStart > 0 && ignoredOffsets.has(runStart - 1) ? point(node, runStart) : undefined,
					backwardStart: runStart > 0 && ignoredOffsets.has(runStart - 1) ? point(node, runStart - 1) : undefined,
					forwardEnd: forwardEnd > sourceEnd ? point(node, forwardEnd) : undefined,
				});
				runStart = undefined;
			}
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return;
		if (node.nodeName === 'BR') {
			if (isStructuralPlaceholderBreak(node)) return;
			if (options.placeholderNodes?.has(node)) return;
			const index = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
			append('\n', node, point(node, 0), point(node, 0), false, {
				backwardStart: point(node.parentNode, index),
				forwardEnd: point(node.parentNode, index + 1),
				backwardEnd: point(node.parentNode, index + 1),
			});
			return;
		}
		if (isAtomic(node)) {
			const index = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
			append('\uFFFC', node, point(node.parentNode, index), point(node.parentNode, index + 1), true);
			return;
		}
		const beforeSegments = segments.length;
		projectChildren(node);
		if (BLOCK_TAGS.has(node.nodeName) && segments.length === beforeSegments && !emptyBlockOffsets.has(node)) {
			emptyBlockOffsets.set(node, text.length);
		}
	};
	projectChildren(root);

	const boundaryPoints = {
		forward: new Array(text.length + 1),
		backward: new Array(text.length + 1),
	};
	segments.forEach((segment, index) => {
		boundaryPoints.forward[segment.start] = segment.forwardStart || segment.startPoint;
		boundaryPoints.backward[segment.end] = segment.backwardEnd || segment.endPoint;
		if (segment.node.nodeType === Node.TEXT_NODE) {
			textParts.push(segment);
			for (let offset = 0; offset <= segment.end - segment.start; offset += 1) {
				const domPoint = point(segment.node, segment.sourceStart + offset);
				boundaryPoints.forward[segment.start + offset] ??= domPoint;
				boundaryPoints.backward[segment.start + offset] ??= domPoint;
			}
		}
		if (index > 0 && segment.start === segments[index - 1].end) {
			const previous = segments[index - 1];
			boundaryPoints.forward[segment.start] = segment.forwardStart ||
				(segment.node.nodeType !== Node.TEXT_NODE ? segment.startPoint : previous.forwardEnd ||
					(previous.node.nodeType === Node.TEXT_NODE ? segment.startPoint : previous.endPoint));
			boundaryPoints.backward[segment.start] = segment.backwardStart || previous.backwardEnd ||
				(segment.node.nodeType === Node.TEXT_NODE ? previous.endPoint : segment.startPoint);
		}
	});
	const first = segments[0];
	const last = segments.at(-1);
	boundaryPoints.forward[0] = first?.forwardStart || first?.startPoint || point(root, 0);
	boundaryPoints.backward[0] = first?.backwardStart || first?.startPoint || point(root, 0);
	boundaryPoints.forward[text.length] = last?.forwardEnd || last?.endPoint || point(root, root.childNodes.length);
	boundaryPoints.backward[text.length] = last?.backwardEnd || last?.endPoint || point(root, root.childNodes.length);
	const terminalEmptyBlock = [...emptyBlockOffsets.entries()].find(([, offset]) => offset === text.length)?.[0];
	if (terminalEmptyBlock) {
		boundaryPoints.forward[text.length] = point(terminalEmptyBlock, 0);
		boundaryPoints.backward[text.length] = point(terminalEmptyBlock, 0);
	}

	const graphemeBoundaries = new Set([0, text.length]);
	const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
	for (const boundary of segmenter.segment(text)) graphemeBoundaries.add(boundary.index);
	const validateOffset = result => {
		if (!Number.isInteger(result) || result < 0 || result > text.length) {
			throw new RangeError('DOM point maps outside text');
		}
		if (!graphemeBoundaries.has(result)) throw new RangeError('DOM point is inside a grapheme cluster');
		return result;
	};

	const contains = (parent, node) => parent === node || parent.contains(node);
	const toOffset = (node, offset) => {
		if (!(node instanceof Node) || !Number.isInteger(offset)) throw new RangeError('DOM point is invalid');
		if (atomicNodes.some(atomic => atomic === node || atomic.contains(node))) {
			throw new RangeError('DOM point is inside an atomic element');
		}
		if (node.nodeType === Node.TEXT_NODE) {
			if (offset < 0 || offset > node.nodeValue.length) throw new RangeError('DOM point is not mapped');
			const candidates = textParts.filter(candidate => candidate.node === node);
			const segment = candidates.find(candidate => offset >= candidate.sourceStart && offset <= candidate.sourceEnd);
			if (segment) return validateOffset(segment.start + offset - segment.sourceStart);
			const next = candidates.find(candidate => candidate.sourceStart > offset);
			if (next) return validateOffset(next.start);
			const previous = candidates.at(-1);
			if (previous && previous.sourceEnd < offset) return validateOffset(previous.end);
			throw new RangeError('DOM point is not mapped');
		}
		if (!contains(root, node) || !Number.isInteger(offset) || offset < 0 || offset > node.childNodes.length) {
			throw new RangeError('DOM point is outside root');
		}
		if (emptyBlockOffsets.has(node) && offset === 0) return validateOffset(emptyBlockOffsets.get(node));
		const exact = segments.find(segment =>
			(segment.startPoint.node === node && segment.startPoint.offset === offset) ||
			(segment.endPoint.node === node && segment.endPoint.offset === offset) ||
			(segment.backwardStart?.node === node && segment.backwardStart.offset === offset) ||
			(segment.forwardEnd?.node === node && segment.forwardEnd.offset === offset));
		if (exact) {
			if ((exact.startPoint.node === node && exact.startPoint.offset === offset) ||
				(exact.backwardStart?.node === node && exact.backwardStart.offset === offset)) return validateOffset(exact.start);
			return validateOffset(exact.end);
		}
		const before = [...node.childNodes].slice(0, offset);
		const after = [...node.childNodes].slice(offset);
		const previous = [...segments].reverse().find(segment => before.some(child => contains(child, segment.node)));
		if (previous) return validateOffset(previous.end);
		const next = segments.find(segment => after.some(child => contains(child, segment.node)));
		if (next) return validateOffset(next.start);
		const result = offset === 0 ? 0 : text.length;
		return validateOffset(result);
	};

	return {
		text,
		segments,
		graphemeBoundaries,
		toDomPoint(offset, bias = 'forward') {
			if (bias !== 'forward' && bias !== 'backward') throw new TypeError('bias must be forward or backward');
			if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
				throw new RangeError('offset is outside text');
			}
			if (!graphemeBoundaries.has(offset)) {
				throw new RangeError('offset is inside a grapheme cluster');
			}
			return boundaryPoints[bias][offset];
		},
		toOffset,
		crossesAtomic(from, to) {
			const start = Math.min(from, to);
			const end = Math.max(from, to);
			return segments.some(segment => segment.atomic && start < segment.end && end > segment.start);
		},
	};
}

module.exports = { createRichTextPositionMap };
