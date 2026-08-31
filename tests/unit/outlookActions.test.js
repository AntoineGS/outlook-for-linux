const test = require('node:test');
const assert = require('node:assert/strict');
const actions = require('../../app/browser/tools/outlookActions');

class Node {
  constructor(tag = 'div', attributes = {}, children = [], text = '') {
    this.tagName = tag.toUpperCase();
    this.attributes = attributes;
    this.children = children;
    this.textContent = text;
    this.parentElement = null;
    this.focusCount = 0;
    this.clickCount = 0;
    this.scrollCount = 0;
    children.forEach((child) => {
      child.parentElement = this;
    });
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name) {
    return Object.hasOwn(this.attributes, name);
  }

  matches(selector) {
    if (selector === '*') return true;
    if (selector.includes(',')) {
      return selector.split(',').some((part) => this.matches(part.trim()));
    }
    const role = selector.match(/\[role="([^"]+)"\]/)?.[1];
    const selected = selector.match(/\[aria-selected="([^"]+)"\]/)?.[1];
    const label = selector.match(/\[aria-label="([^"]+)"\]/)?.[1];
    const disabled = selector.includes('[aria-disabled="true"]');
    const textbox = selector.includes('[contenteditable="true"]');
    const searchInput = selector.includes('[type="search"]');
    const checkbox = selector.includes('[type="checkbox"]');
    const checked = selector.match(/\[aria-checked="([^"]+)"\]/)?.[1];
    const dataMessage = selector.includes('[data-message-id]');
    const hasLabel = selector === '[aria-label]';
    const tag = selector.match(/^[a-z]+/i)?.[0];
    return (!tag || this.tagName === tag.toUpperCase())
      && (!hasLabel || this.hasAttribute('aria-label'))
      && (!role || this.getAttribute('role') === role)
      && (!selected || this.getAttribute('aria-selected') === selected)
      && (!label || this.getAttribute('aria-label') === label)
      && (!disabled || this.getAttribute('aria-disabled') === 'true')
      && (!textbox || this.getAttribute('contenteditable') === 'true')
      && (!searchInput || this.getAttribute('type') === 'search')
      && (!checkbox || this.getAttribute('type') === 'checkbox')
      && (!checked || this.getAttribute('aria-checked') === checked)
      && (!dataMessage || this.hasAttribute('data-message-id'));
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      if (node.matches(selector)) matches.push(node);
      node.children.forEach(visit);
    };
    this.children.forEach(visit);
    return nodeList(matches);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  focus() {
    this.focusCount += 1;
  }

  click() {
    this.clickCount += 1;
  }

  scrollIntoView() {
    this.scrollCount += 1;
  }
}

const nodeList = (items) => ({
  ...Object.fromEntries(items.map((item, index) => [index, item])),
  length: items.length,
  [Symbol.iterator]: function* iterator() {
    yield* items;
  },
});

const option = (label, selected = 'false') => new Node('div', {
  role: 'option',
  'aria-label': label,
  'aria-selected': selected,
});

const documentWith = (...roots) => ({
  activeElement: null,
  querySelectorAll: (selector) => nodeList(roots.flatMap((root) => [
    ...(root.matches(selector) ? [root] : []),
    ...Array.from(root.querySelectorAll(selector)),
  ])),
  querySelector: (selector) => roots.flatMap((root) => [
    ...(root.matches(selector) ? [root] : []),
    ...Array.from(root.querySelectorAll(selector)),
  ])[0] ?? null,
});

test('moves to the next and previous message within the semantic mail list', () => {
  const rows = [option('Read first'), option('Unread second', 'true'), option('Read third')];
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail list' }, rows);
  const document = documentWith(list);

  assert.equal(actions.nextMessage(document), true);
  assert.equal(rows[2].clickCount, 1);
  assert.equal(actions.previousMessage(document), true);
  assert.equal(rows[0].clickCount, 1);
});

test('moves to first and last rendered message and reports rendered boundaries', () => {
  const rows = [option('Read first'), option('Read second', 'true'), option('Read last')];
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Messages' }, rows);
  const document = documentWith(list);

  assert.equal(actions.firstMessage(document), true);
  assert.equal(rows[0].clickCount, 1);
  assert.equal(actions.lastMessage(document), true);
  assert.equal(rows[2].clickCount, 1);
  rows.forEach((row) => {
    row.attributes['aria-selected'] = 'false';
  });
  rows[2].attributes['aria-selected'] = 'true';
  assert.equal(actions.nextMessage(document), false);
});

test('message movement ignores listboxes inside search contexts while activating the message list', () => {
  const messageRows = [option('Read message', 'true'), option('Unread next')];
  const messageList = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, messageRows);
  const picker = new Node('div', { role: 'listbox', 'aria-label': 'People picker' }, [option('Read picker')]);
  const search = new Node('div', { role: 'search' }, [picker]);

  assert.equal(actions.nextMessage(documentWith(messageList, search)), true);
  assert.equal(messageRows[1].clickCount, 1);
});

test('message movement rejects an unrelated selected picker listbox', () => {
  const pickerRow = option('Read picker', 'true');
  const secondPickerRow = option('Unread picker');
  const picker = new Node('div', { role: 'listbox', 'aria-label': 'People picker' }, [pickerRow, secondPickerRow]);
  const combobox = new Node('div', { role: 'combobox' }, [picker]);

  assert.equal(actions.nextMessage(documentWith(combobox)), false);
  assert.equal(secondPickerRow.clickCount, 0);
});

test('message movement rejects listboxes inside dialogs', () => {
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail list' }, [option('Read dialog', 'true')]);
  const dialog = new Node('div', { role: 'dialog' }, [list]);

  assert.equal(actions.nextMessage(documentWith(dialog)), false);
});

test('message actions reject listboxes inside native dialogs', () => {
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail list' }, [option('Read dialog', 'true')]);
  const dialog = new Node('dialog', {}, [list]);

  assert.equal(actions.nextMessage(documentWith(dialog)), false);
});

test('message actions reject multiple selected rows', () => {
  const rows = [option('Read first', 'true'), option('Read second', 'true'), option('Read third')];
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail list' }, rows);

  assert.equal(actions.openMessage(documentWith(list)), false);
  assert.equal(actions.nextMessage(documentWith(list)), false);
  assert.equal(rows[0].clickCount + rows[1].clickCount, 0);
});

test('accepts unlabeled semantic rows but rejects active rows outside the accepted list', () => {
  const row = option('Unread message', 'true');
   const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [row]);
  const outside = option('Read unrelated', 'true');
  const document = documentWith(list, outside);
  document.activeElement = outside;

  assert.equal(actions.nextMessage(document), false);
  assert.equal(actions.firstMessage(document), true);
  assert.equal(row.focusCount, 1);
});

test('collapses and expands the selected conversation', () => {
  const disclosure = new Node('button', { 'aria-expanded': 'true' });
  const selected = new Node('div', { role: 'option', 'aria-selected': 'true' }, [disclosure]);
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail' }, [selected]);
  const document = documentWith(list);

  assert.equal(actions.collapseConversation(document), true);
  assert.equal(disclosure.clickCount, 1);
  disclosure.attributes['aria-expanded'] = 'false';
  assert.equal(actions.expandConversation(document), true);
  assert.equal(disclosure.clickCount, 2);
});

test('activates exact visible mail controls and refuses duplicate winners', () => {
  const archive = new Node('button', { 'aria-label': 'Archive' });
  const toolbar = new Node('div', { role: 'toolbar' }, [archive]);
  const document = documentWith(toolbar);

  assert.equal(actions.archive(document), true);
  assert.equal(archive.clickCount, 1);

  const duplicate = documentWith(
    new Node('div', { role: 'toolbar' }, [new Node('button', { 'aria-label': 'Delete' })]),
    new Node('div', { role: 'main' }, [new Node('button', { 'aria-label': 'Delete' })]),
  );
  assert.equal(actions.deleteMessage(duplicate), false);
});

test('ignores hidden and disabled controls and prefers an exact label over descendant text', () => {
  const hidden = new Node('button', { 'aria-label': 'Archive', hidden: '' });
  const disabled = new Node('button', { 'aria-label': 'Archive', disabled: '' });
  const label = new Node('span', {}, [], 'Archive');
  const exact = new Node('button', { 'aria-label': 'Archive' }, [label]);
  const toolbar = new Node('div', { role: 'toolbar' }, [hidden, disabled, exact]);
  const document = documentWith(toolbar);

  assert.equal(actions.archive(document), true);
  assert.equal(exact.clickCount, 1);
  assert.equal(hidden.clickCount, 0);
  assert.equal(disabled.clickCount, 0);
});

test('uses state-specific read and flag labels and scopes folders to navigation', () => {
  const read = new Node('button', { 'aria-label': 'Mark as unread' });
  const flag = new Node('button', { 'aria-label': 'Unflag this message' });
  const inbox = new Node('div', { role: 'treeitem', 'aria-label': 'Inbox' });
  const toolbar = new Node('div', { role: 'toolbar' }, [read, flag]);
  const navigation = new Node('nav', { role: 'navigation' }, [inbox]);
  const document = documentWith(toolbar, navigation);

  assert.equal(actions.toggleRead(document), true);
  assert.equal(actions.toggleFlag(document), true);
  assert.equal(actions.inbox(document), true);
  assert.equal(read.clickCount, 1);
  assert.equal(flag.clickCount, 1);
  assert.equal(inbox.clickCount, 1);
});

test('does not activate folder labels outside the folder navigation scope', () => {
  const inbox = new Node('button', { 'aria-label': 'Inbox' });
  const main = new Node('div', { role: 'main' }, [inbox]);

  assert.equal(actions.inbox(documentWith(main)), false);
  assert.equal(inbox.clickCount, 0);
});

test('search activates Outlook search and focuses one visible textbox', () => {
  const search = new Node('button', { 'aria-label': 'Search' });
  const textbox = new Node('input', { role: 'textbox' });
  const root = new Node('div', { role: 'search' }, [search, textbox]);
  const document = documentWith(root);

  assert.equal(actions.search(document), true);
  assert.equal(search.clickCount, 1);
  assert.equal(textbox.focusCount, 1);
});

test('exposes the scoped control resolver and injectable logger', () => {
  const messages = [];
  const customLogger = { debug: (...args) => messages.push(args) };
  const previousLogger = actions._test.setLogger(customLogger);
  const control = new Node('button', { 'aria-label': 'Back' });
  const root = new Node('div', { role: 'main' }, [control]);

  try {
    assert.equal(actions._test.findLabeledControl(root, ['Back']), control);
    assert.equal(actions.back(documentWith(root)), true);
    assert.equal(messages.length, 0);
  } finally {
    assert.equal(actions._test.setLogger(previousLogger), customLogger);
  }
});

test('ranks exact controls globally across roots instead of rejecting a weaker descendant match', () => {
  const descendant = new Node('span', {}, [], 'Delete');
  const weak = new Node('button', {}, [descendant]);
  const exact = new Node('button', { 'aria-label': 'Delete' });

  assert.equal(actions.deleteMessage(documentWith(
    new Node('div', { role: 'toolbar' }, [weak]),
    new Node('div', { role: 'main' }, [exact]),
  )), true);
  assert.equal(weak.clickCount, 0);
  assert.equal(exact.clickCount, 1);
});

test('rejects controls hidden by an ancestor', () => {
  const hiddenAncestor = new Node('div', { 'aria-hidden': 'true' });
  const control = new Node('button', { 'aria-label': 'Archive' });
  hiddenAncestor.children = [control];
  control.parentElement = hiddenAncestor;

  assert.equal(actions.archive(documentWith(new Node('div', { role: 'toolbar' }, [hiddenAncestor]))), false);
  assert.equal(control.clickCount, 0);
});

test('collapse and expand require the selected conversation disclosure state', () => {
  const disclosure = new Node('button', { 'aria-expanded': 'true' });
  const selected = new Node('div', { role: 'option', 'aria-selected': 'true' }, [disclosure]);
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail' }, [selected]);
  const document = documentWith(list);

  assert.equal(actions.collapseConversation(document), true);
  assert.equal(disclosure.clickCount, 1);
  disclosure.attributes['aria-expanded'] = 'false';
  assert.equal(actions.expandConversation(document), true);
  assert.equal(disclosure.clickCount, 2);
  disclosure.attributes['aria-expanded'] = 'true';
  assert.equal(actions.expandConversation(document), false);
});

test('conversation actions require exactly one visible enabled disclosure', () => {
  const selected = new Node('div', { role: 'option', 'aria-selected': 'true' });
  const first = new Node('button', { 'aria-expanded': 'true' });
  const duplicate = new Node('div', { role: 'button', 'aria-expanded': 'true' });
  selected.children = [first, duplicate];
  first.parentElement = selected;
  duplicate.parentElement = selected;
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail' }, [selected]);

  assert.equal(actions.collapseConversation(documentWith(list)), false);
  assert.equal(first.clickCount + duplicate.clickCount, 0);

  const hidden = new Node('button', { 'aria-expanded': 'true', hidden: '' });
  const disabled = new Node('button', { 'aria-expanded': 'true', disabled: '' });
  selected.children = [hidden, disabled];
  hidden.parentElement = selected;
  disabled.parentElement = selected;

  assert.equal(actions.collapseConversation(documentWith(list)), false);
  assert.equal(hidden.clickCount + disabled.clickCount, 0);
});

test('conversation actions return false without a selected conversation', () => {
  const row = option('Read message');
  const disclosure = new Node('button', { 'aria-expanded': 'true' });
  row.querySelector = () => disclosure;
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail' }, [row]);
  const document = documentWith(list);

  assert.equal(actions.collapseConversation(document), false);
  assert.equal(actions.expandConversation(document), false);
  assert.equal(disclosure.clickCount, 0);
});

test('openMessage activates the selected rendered row', () => {
  const rows = [option('Read first'), option('Read selected', 'true'), option('Unread last')];
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, rows);

  assert.equal(actions.openMessage(documentWith(list)), true);
  assert.equal(rows[1].clickCount, 1);
});

test('search does not focus a textbox when Search activation fails', () => {
  const textbox = new Node('input', { role: 'textbox' });
  const search = new Node('div', { role: 'search' }, [textbox]);

  assert.equal(actions.search(documentWith(search)), false);
  assert.equal(textbox.focusCount, 0);
});

test('search focuses input type search in the search context after activation', () => {
  const searchButton = new Node('button', { 'aria-label': 'Search' });
  const textbox = new Node('input', { type: 'search' });
  const search = new Node('div', { role: 'search' }, [searchButton, textbox]);

  assert.equal(actions.search(documentWith(search)), true);
  assert.equal(textbox.focusCount, 1);
});

test('search prefers role searchbox and never focuses a competing generic textbox outside search', () => {
  const searchButton = new Node('button', { 'aria-label': 'Search' });
  const searchbox = new Node('input', { role: 'searchbox' });
  const search = new Node('div', { role: 'search' }, [searchbox]);
  const composeTextbox = new Node('input', { role: 'textbox' });
  const toolbar = new Node('div', { role: 'toolbar' }, [searchButton, composeTextbox]);

  assert.equal(actions.search(documentWith(toolbar, search)), true);
  assert.equal(searchbox.focusCount, 1);
  assert.equal(composeTextbox.focusCount, 0);
});

test('search does not fall back to a generic textbox outside a search landmark', () => {
  const searchButton = new Node('button', { 'aria-label': 'Search' });
  const composeTextbox = new Node('input', { role: 'textbox' });
  const toolbar = new Node('div', { role: 'toolbar' }, [searchButton, composeTextbox]);

  assert.equal(actions.search(documentWith(toolbar)), true);
  assert.equal(composeTextbox.focusCount, 0);
});

test('folder actions activate actionable descendant treeitems', () => {
  const inbox = new Node('div', { role: 'treeitem', 'aria-label': '  INBOX  ' });
  const tree = new Node('div', { role: 'tree' }, [inbox]);

  assert.equal(actions.inbox(documentWith(tree)), true);
  assert.equal(inbox.clickCount, 1);
});

test('mail actions reject navigation scope and duplicate global matches', () => {
  const navigationControl = new Node('button', { 'aria-label': 'Archive' });
  assert.equal(actions.archive(documentWith(
    new Node('div', { role: 'navigation' }, [navigationControl]),
  )), false);

  const first = new Node('button', { 'aria-label': 'Archive' });
  const second = new Node('button', { 'aria-label': 'Archive' });
  assert.equal(actions.archive(documentWith(
    new Node('div', { role: 'toolbar' }, [first]),
    new Node('div', { role: 'region' }, [second]),
  )), false);
  assert.equal(first.clickCount + second.clickCount, 0);
});

function createLegacyControl(label, visible = true) {
  return {
    label,
    clickCalls: 0,
    textContent: label,
    parentElement: null,
    getAttribute(name) {
      return name === 'aria-label' ? label : null;
    },
    getClientRects: () => (visible ? [{}] : []),
    click() {
      this.clickCalls += 1;
    },
    querySelectorAll: () => nodeList([]),
  };
}

function createLegacyRoot(controls) {
  return { querySelectorAll: () => nodeList(controls) };
}

function createLegacyActionDocument(scopes) {
  const roots = Object.fromEntries(Object.entries(scopes).map(([scope, controls]) => [scope, createLegacyRoot(controls)]));
  return {
    querySelectorAll: (selector) => {
      const scope = Object.keys(roots).find((name) => selector.includes(`[role="${name}"]`));
      return nodeList(scope ? [roots[scope]] : []);
    },
  };
}

test('authenticated Outlook search and compose labels resolve exactly', () => {
  const search = createLegacyControl('Search for email, meetings, files and more.');
  const compose = createLegacyControl('New email');
  const document = createLegacyActionDocument({ toolbar: [search, compose] });

  assert.equal(actions.search(document), true);
  assert.equal(actions.compose(document), true);
  assert.equal(search.clickCalls, 1);
  assert.equal(compose.clickCalls, 1);
});

test('search focuses its semantic search textbox instead of a compose textbox', () => {
  const search = createLegacyControl('Search');
  const searchTextbox = { focusCalls: 0, focus() { this.focusCalls += 1; } };
  const composeTextbox = { focusCalls: 0, focus() { this.focusCalls += 1; } };
  const searchRoot = createLegacyRoot([search]);
  searchRoot.querySelectorAll = (selector) => selector.includes('textbox')
    ? nodeList([searchTextbox]) : nodeList([search]);
  const composeRoot = createLegacyRoot([composeTextbox]);
  const document = {
    querySelectorAll: (selector) => selector === '[role="search"]'
      ? nodeList([searchRoot]) : selector === '[role="toolbar"]' ? nodeList([composeRoot]) : nodeList([]),
  };

  assert.equal(actions.search(document), true);
  assert.equal(searchTextbox.focusCalls, 1);
  assert.equal(composeTextbox.focusCalls, 0);
});

test('search resolves its semantic search landmark', () => {
  const search = createLegacyControl('Search');
  const document = createLegacyActionDocument({ search: [search] });

  assert.equal(actions.search(document), true);
  assert.equal(search.clickCalls, 1);
});

test('folder actions resolve Inbox, Sent Items, and Drafts only in folder scope', () => {
  for (const [action, label] of [['inbox', 'Inbox'], ['sent', 'Sent Items'], ['drafts', 'Drafts']]) {
    const outside = createLegacyControl(label);
    assert.equal(actions[action](createLegacyActionDocument({ toolbar: [outside] })), false);
    assert.equal(outside.clickCalls, 0);

    const folder = createLegacyControl(label);
    assert.equal(actions[action](createLegacyActionDocument({ navigation: [folder] })), true);
    assert.equal(folder.clickCalls, 1);
  }
});

test('folder actions resolve exact descendant names on treeitems', () => {
  const name = createLegacyControl('Inbox');
  const treeitem = createLegacyControl('Inbox selected 35 unread');
  treeitem.querySelectorAll = () => nodeList([name]);

  assert.equal(actions.inbox(createLegacyActionDocument({ tree: [treeitem] })), true);
  assert.equal(treeitem.clickCalls, 1);
});

test('mail actions require mail scope and reject ambiguity across scopes', () => {
  for (const [action, label] of [
    ['reply', 'Reply'], ['replyAll', 'Reply all'], ['forward', 'Forward'],
    ['archive', 'Archive'], ['toggleFlag', 'Flag'], ['back', 'Back'], ['compose', 'New mail'],
  ]) {
    const navigation = createLegacyControl(label);
    assert.equal(actions[action](createLegacyActionDocument({ navigation: [navigation] })), false);
    assert.equal(navigation.clickCalls, 0);

    const toolbar = createLegacyControl(label);
    assert.equal(actions[action](createLegacyActionDocument({ toolbar: [toolbar] })), true);
    assert.equal(toolbar.clickCalls, 1);

    const first = createLegacyControl(label);
    const second = createLegacyControl(label);
    assert.equal(actions[action](createLegacyActionDocument({ toolbar: [first], region: [second] })), false);
    assert.equal(first.clickCalls + second.clickCalls, 0);
  }
});

test('diagnostics distinguish absent and ambiguous controls and message lists', () => {
  const messages = [];
  const previousLogger = actions._test.setLogger({ debug(...args) { messages.push(args.join(' ')); } });
  try {
    assert.equal(actions.deleteMessage(createLegacyActionDocument({ toolbar: [] })), false);
    const first = createLegacyControl('Delete');
    const second = createLegacyControl('Delete');
    assert.equal(actions.deleteMessage(createLegacyActionDocument({ toolbar: [first], region: [second] })), false);
    assert.equal(messages.length, 2);
  } finally {
    assert.equal(actions._test.setLogger(previousLogger).debug instanceof Function, true);
  }
});

test('visibility rejects ARIA-hidden, inert, disabled, and computed-style-hidden controls', () => {
  for (const attribute of ['aria-hidden', 'inert', 'disabled']) {
    const control = createLegacyControl('Delete');
    control.getAttribute = (name) => name === 'aria-label' ? 'Delete'
      : name === attribute ? (attribute === 'aria-hidden' ? 'true' : '') : null;
    assert.equal(actions.deleteMessage(createLegacyActionDocument({ toolbar: [control] })), false);
  }

  const ancestor = { parentElement: null };
  const control = createLegacyControl('Delete');
  control.parentElement = ancestor;
  control.ownerDocument = {
    defaultView: { getComputedStyle: (node) => node === ancestor
      ? { display: 'none', visibility: 'visible' }
      : { display: 'block', visibility: 'visible' } },
  };
  assert.equal(actions.deleteMessage(createLegacyActionDocument({ toolbar: [control] })), false);
});

test('message navigation rejects an active option outside the accepted rendered rows', () => {
  const rows = [option('Read first'), option('Read second')];
  const outside = option('Read outside');
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail' }, rows);
  const document = documentWith(list, outside);
  document.activeElement = outside;

  assert.equal(actions.nextMessage(document), false);
  assert.equal(rows[1].clickCount, 0);
});

test('message-list diagnostics distinguish absent and ambiguous candidates', () => {
  const messages = [];
  const previousLogger = actions._test.setLogger({ debug(...args) { messages.push(args.join(' ')); } });
  try {
    assert.equal(actions.nextMessage({ querySelectorAll: () => nodeList([]), activeElement: null }), false);
    const first = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [option('Read one', 'true')]);
    const second = new Node('div', { role: 'listbox', 'aria-label': 'Sent mail' }, [option('Read two')]);
    assert.equal(actions.nextMessage(documentWith(first, second)), false);
    assert.deepEqual(messages, ['message-list absent', 'message-list ambiguous']);
  } finally {
    assert.equal(actions._test.setLogger(previousLogger).debug instanceof Function, true);
  }
});

test('search refuses to focus when its context has multiple visible textboxes', () => {
  const searchButton = new Node('button', { 'aria-label': 'Search' });
  const first = new Node('input', { role: 'textbox' });
  const second = new Node('input', { type: 'search' });
  const search = new Node('div', { role: 'search' }, [searchButton, first, second]);

  assert.equal(actions.search(documentWith(search)), true);
  assert.equal(first.focusCount + second.focusCount, 0);
});

const ROUTES = [
  ['composeMessage', 'compose'],
  ['openMessageNewWindow', 'openNewWindow'],
  ['archiveMessage', 'archive'],
  ['deleteMessage', 'delete'],
  ['permanentlyDeleteMessage', 'permanentDelete'],
  ['reply', 'reply'],
  ['replyAll', 'replyAll'],
  ['forward', 'forward'],
  ['toggleFlag', 'flag'],
  ['pageUp', 'pageUp'],
  ['pageDown', 'pageDown'],
  ['shortcutHelp', 'shortcutHelp'],
];

const eventFor = (key) => key === '?' ? {
  key,
  keyCode: '/',
  shiftKey: true,
} : { key, keyCode: key.toUpperCase() };

test('factory native routes delegate exactly once and preserve physical pass-through', () => {
  const calls = [];
  const nativeActions = actions.createOutlookActions({
    replayShortcut(id, event) {
      calls.push([id, event]);
      return true;
    },
  });
   const document = documentWith(new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [mailboxRow({ selected: 'true' })]));

  for (const [name] of ROUTES) {
    const event = eventFor(['archiveMessage', 'reply', 'shortcutHelp'].includes(name) ? 'x' : name);
    const result = nativeActions[name](document, event);
    assert.equal(result, true);
  }

  assert.equal(calls.length, ROUTES.length);
  assert.deepEqual(calls.map(([id]) => id), ROUTES.map(([, id]) => id));
});

test('native route methods pass through matching Outlook physical events without replay', () => {
  const calls = [];
  const nativeActions = actions.createOutlookActions({
    replayShortcut(id, event) {
      calls.push([id, event]);
      return true;
    },
  });
   const document = documentWith(new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [mailboxRow({ selected: 'true' })]));

  assert.equal(nativeActions.archiveMessage(document, { key: 'e', keyCode: 69 }), 'pass-through');
  assert.equal(nativeActions.reply(document, { key: 'r', keyCode: 82 }), 'pass-through');
  assert.equal(nativeActions.shortcutHelp(document, { key: '?', keyCode: 191, shiftKey: true }), 'pass-through');
  assert.equal(calls.length, 0);
});

test('native pass-through requires an exact physical modifier set', () => {
  const calls = [];
  const nativeActions = actions.createOutlookActions({
    replayShortcut(id, event) {
      calls.push([id, event]);
      return true;
    },
  });

  assert.equal(nativeActions.archiveMessage(documentWith(), { key: 'e', keyCode: 69, ctrlKey: true }), true);
  assert.equal(nativeActions.reply(documentWith(), { key: 'r', keyCode: 82, shiftKey: true }), true);
  assert.equal(nativeActions.shortcutHelp(documentWith(), { key: '?', keyCode: 191, shiftKey: true, altKey: true }), true);
  assert.deepEqual(calls.map(([id]) => id), ['archive', 'reply', 'shortcutHelp']);
});

test('scoped controls use the uniquely identified command toolbar', () => {
  const compose = new Node('button', { 'aria-label': 'New mail' });
  const target = new Node('button', { 'aria-label': 'New mail in new window' });
  const distractor = new Node('button', { 'aria-label': 'New mail in new window' });
  const commandToolbar = new Node('div', { role: 'toolbar' }, [compose, target]);
  const otherToolbar = new Node('div', { role: 'toolbar' }, [distractor]);
  const nativeActions = actions.createOutlookActions({ replayShortcut: () => true });

  assert.equal(nativeActions.composeNewTab(documentWith(commandToolbar, otherToolbar), {}), true);
  assert.equal(target.clickCount, 1);
  assert.equal(distractor.clickCount, 0);
});

test('scoped new-window controls use exact labels', () => {
  const controls = [
    ['replyNewWindow', 'Reply in new window'],
    ['replyAllNewWindow', 'Reply all in new window'],
    ['forwardNewWindow', 'Forward in new window'],
  ];
  for (const [action, label] of controls) {
    const control = new Node('button', { 'aria-label': label });
    const selected = new Node('div', { role: 'option', 'aria-selected': 'true' }, [control]);
    const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail' }, [selected]);
    const nativeActions = actions.createOutlookActions({ replayShortcut: () => true });

    assert.equal(nativeActions[action](documentWith(list), {}), true);
    assert.equal(control.clickCount, 1);
  }
});

test('scoped controls reject two command toolbars with compose anchors', () => {
  const firstCompose = new Node('button', { 'aria-label': 'New mail' });
  const secondCompose = new Node('button', { 'aria-label': 'New message' });
  const firstTarget = new Node('button', { 'aria-label': 'New mail in new window' });
  const secondTarget = new Node('button', { 'aria-label': 'New message in new window' });
  const firstToolbar = new Node('div', { role: 'toolbar' }, [firstCompose, firstTarget]);
  const secondToolbar = new Node('div', { role: 'toolbar' }, [secondCompose, secondTarget]);
  const nativeActions = actions.createOutlookActions({ replayShortcut: () => true });

  assert.equal(nativeActions.composeNewTab(documentWith(firstToolbar, secondToolbar), {}), false);
  assert.equal(firstTarget.clickCount + secondTarget.clickCount, 0);
});

test('scoped controls search selected message and reading region but reject ambiguity', () => {
  const selected = new Node('div', { role: 'option', 'aria-selected': 'true' }, [
    new Node('button', { 'aria-label': 'Undo' }),
  ]);
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail' }, [selected]);
  const nativeActions = actions.createOutlookActions({ replayShortcut: () => true });
  const commandToolbar = new Node('div', { role: 'toolbar' }, [
    new Node('button', { 'aria-label': 'New mail' }),
    new Node('button', { 'aria-label': 'Undo' }),
    new Node('button', { 'aria-label': 'Redo' }),
  ]);
  assert.equal(nativeActions.undo(documentWith(commandToolbar), { target: commandToolbar.children[1] }), true);
  assert.equal(commandToolbar.children[1].clickCount, 1);
  assert.equal(nativeActions.redo(documentWith(commandToolbar), { target: commandToolbar.children[2] }), true);
  assert.equal(commandToolbar.children[2].clickCount, 1);

  const duplicate = new Node('div', { role: 'region', 'aria-label': 'Message reading pane' }, [
    new Node('button', { 'aria-label': 'Undo' }),
  ]);
  assert.equal(nativeActions.undo(documentWith(list, duplicate), { target: duplicate.children[0] }), false);
  assert.equal(duplicate.children[0].clickCount, 0);
});

test('scoped controls reject unrelated visible regions', () => {
  const control = new Node('button', { 'aria-label': 'Undo' });
  const unrelated = new Node('div', { role: 'region', 'aria-label': 'Calendar' }, [control]);
  const nativeActions = actions.createOutlookActions({ replayShortcut: () => true });

  assert.equal(nativeActions.undo(documentWith(unrelated), { target: control }), false);
  assert.equal(control.clickCount, 0);
});

test('scoped controls reject navigation and calendar regions despite active focus', () => {
  for (const label of ['Mail navigation', 'Calendar content']) {
    const control = new Node('button', { 'aria-label': 'Undo' });
    const region = new Node('div', { role: 'region', 'aria-label': label }, [control]);
    const nativeActions = actions.createOutlookActions({ replayShortcut: () => true });

    assert.equal(nativeActions.undo(documentWith(region), { target: control }), false);
    assert.equal(control.clickCount, 0);
  }
});

const eventAt = (target, path = [target]) => ({ target, composedPath: () => path });

const mailboxRow = ({ label = 'Read message', selected = 'false', read = 'read', flagged = null } = {}) => {
  const semanticLabel = label === 'Read message' && read === 'unread' ? 'Unread message'
    : label === 'Read message' && read === 'unknown' ? 'Message' : label;
  const attributes = { role: 'option', 'aria-label': semanticLabel, 'aria-selected': selected };
  if (read !== 'unknown') attributes['data-read-state'] = read;
  if (flagged !== null) attributes['data-flag-state'] = flagged ? 'flagged' : 'unflagged';
  if (flagged !== null) attributes['aria-pressed'] = String(flagged);
  const checkbox = new Node('input', { type: 'checkbox', 'aria-checked': selected });
  checkbox.checked = selected === 'true';
  const row = new Node('div', attributes, [checkbox]);
  return row;
};

test('resolveContext applies guarded, multi-selection, folder, list, reading precedence', () => {
  const search = new Node('div', { role: 'search' });
  const dialog = new Node('div', { role: 'dialog' }, [search]);
  const multi = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [
    mailboxRow({ selected: 'true' }), mailboxRow({ selected: 'true', label: 'Read two' }),
  ]);
  const folder = new Node('div', { role: 'tree' }, [new Node('div', { role: 'treeitem', 'aria-label': 'Inbox' })]);
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [mailboxRow({ selected: 'true' })]);
  const reading = new Node('div', { role: 'region', 'aria-label': 'Message reading pane' }, [new Node('button')]);
  assert.equal(actions.resolveContext(documentWith(dialog), eventAt(search)), 'guarded');
  assert.equal(actions.resolveContext(documentWith(multi), eventAt(multi.children[0])), 'multi-selection');
  assert.equal(actions.resolveContext(documentWith(folder), eventAt(folder.children[0])), 'folder');
  assert.equal(actions.resolveContext(documentWith(list), eventAt(list.children[0])), 'message-list');
  assert.equal(actions.resolveContext(documentWith(reading), eventAt(reading.children[0])), 'reading');
});

test('resolveContext returns null when focus path and semantic roots disagree or roots are ambiguous', () => {
  const row = mailboxRow({ selected: 'true' });
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [row]);
  const folder = new Node('div', { role: 'tree' }, [new Node('div', { role: 'treeitem', 'aria-label': 'Inbox' })]);
  const document = documentWith(list, folder);
  document.activeElement = folder.children[0];
  assert.equal(actions.resolveContext(document, eventAt(row)), null);
  assert.equal(actions.resolveContext(documentWith(
    new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [mailboxRow()]),
    new Node('div', { role: 'listbox', 'aria-label': 'Sent messages' }, [mailboxRow()]),
  ), eventAt(null)), null);
});

test('moveRight and moveLeft choose folder replay, disclosure, or safe row behavior', () => {
  const calls = [];
  const vim = actions.createOutlookActions({ replayShortcut: (id) => { calls.push(id); return true; } });
  const tree = new Node('div', { role: 'tree' }, [new Node('div', { role: 'treeitem', 'aria-label': 'Inbox' })]);
  assert.equal(vim.moveRight(documentWith(tree), eventAt(tree.children[0])), true);
  assert.equal(vim.moveLeft(documentWith(tree), eventAt(tree.children[0])), true);
  const disclosure = new Node('button', { 'aria-expanded': 'false' });
  const row = mailboxRow({ selected: 'true' });
  row.children.push(disclosure); disclosure.parentElement = row;
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [row]);
  assert.equal(vim.moveRight(documentWith(list), eventAt(row)), true);
  assert.equal(disclosure.clickCount, 1);
  assert.equal(vim.moveLeft(documentWith(list), eventAt(row)), false);
  assert.deepEqual(calls, ['folderExpand', 'folderCollapse']);
});

test('readContext, escapeContext, and context boundaries use the resolved context', () => {
  const calls = [];
  const vim = actions.createOutlookActions({ replayShortcut: (id) => { calls.push(id); return true; } });
  const unread = mailboxRow({ selected: 'true', read: 'unread' });
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [unread]);
  assert.equal(vim.readContext(documentWith(list), eventAt(unread)), true);
  assert.equal(vim.startContext(documentWith(list), eventAt(unread)), true);
  assert.equal(vim.endContext(documentWith(list), eventAt(unread)), true);
  assert.deepEqual(calls, ['markRead', 'firstList']);
  assert.equal(unread.clickCount, 1);
   const readingControl = new Node('button', { 'aria-label': 'Mark as unread' });
   const readingMessage = new Node('div', { role: 'article', 'data-message-id': 'selected' }, [readingControl]);
   const reading = new Node('div', { role: 'region', 'aria-label': 'Message reading pane' }, [readingMessage]);
   assert.equal(vim.readContext(documentWith(reading), eventAt(readingControl)), true);
  assert.equal(vim.startContext(documentWith(reading), eventAt(reading.children[0])), true);
  assert.equal(vim.endContext(documentWith(reading), eventAt(reading.children[0])), true);
  assert.deepEqual(calls.slice(-2), ['topMessage', 'bottomMessage']);
});

test('selection actions click only matching unchecked row checkboxes and preserve selection', () => {
  const rows = [mailboxRow({ read: 'read' }), mailboxRow({ read: 'unread', label: 'Unread' }), mailboxRow({ read: 'unknown', label: 'Unknown' })];
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, rows);
  assert.equal(actions.selectRead(documentWith(list)), true);
  assert.equal(rows[0].children[0].clickCount, 1);
  assert.equal(rows[1].children[0].clickCount, 0);
  assert.equal(rows[2].children[0].clickCount, 0);
  assert.equal(actions.selectUnread(documentWith(list)), true);
  assert.equal(rows[1].children[0].clickCount, 1);
});

test('folder destinations and label use exact visible controls', () => {
  const labels = ['Inbox', 'Flagged', 'Snoozed', 'Sent Items', 'Drafts', 'All Mail', 'Tasks'];
  const tree = new Node('div', { role: 'tree' }, labels.map(label => new Node('div', { role: 'treeitem', 'aria-label': label })));
  const label = new Node('button', { 'aria-label': 'Categories/Label' });
  const toolbar = new Node('div', { role: 'toolbar' }, [new Node('button', { 'aria-label': 'New mail' }), label]);
  const document = documentWith(tree, toolbar);
  for (const action of ['inbox', 'flagged', 'snoozed', 'sent', 'drafts', 'allMail', 'tasks']) assert.equal(actions[action](document), true);
  assert.equal(actions.label(document), true);
  assert.equal(label.clickCount, 1);
});

test('conversation navigation prefers exact controls and uses unique ordered message fallback', () => {
  const previous = new Node('button', { 'aria-label': 'Previous message' });
  const next = new Node('button', { 'aria-label': 'Next message' });
  const conversation = new Node('div', { role: 'region', 'aria-label': 'Conversation view' }, [previous, next]);
  const vim = actions.createOutlookActions({ replayShortcut: () => true });
  assert.equal(vim.previousConversationMessage(documentWith(conversation), eventAt(previous)), true);
  assert.equal(vim.nextConversationMessage(documentWith(conversation), eventAt(next)), true);
  assert.equal(previous.clickCount, 1);
  assert.equal(next.clickCount, 1);
  assert.equal(vim.nextPage(documentWith(conversation), eventAt(conversation)), true);
  assert.equal(vim.previousPage(documentWith(conversation), eventAt(conversation)), true);
});

test('standalone message and conversation labels require an active individual message', () => {
  for (const label of ['Message', 'Conversation']) {
    const control = new Node('button', { 'aria-label': 'Mark as unread' });
     const region = new Node('div', { role: 'region', 'aria-label': label }, [control]);
     const document = documentWith(region);
     assert.equal(actions.resolveContext(document, eventAt(control)), 'reading');
     assert.equal(actions.createOutlookActions({ replayShortcut: () => true })
       .readContext(document, eventAt(control)), false);
   }
});

test('absent and ambiguous diagnostics expose only stable action id and status', () => {
  const entries = [];
  const previousLogger = actions._test.setLogger({ debug: (...args) => entries.push(args) });
  try {
    actions.archive(documentWith());
    actions.archive(documentWith(
      new Node('div', { role: 'toolbar' }, [new Node('button', { 'aria-label': 'Archive' })]),
      new Node('div', { role: 'main' }, [new Node('button', { 'aria-label': 'Archive' })]),
    ));
    assert.deepEqual(entries, [['archive', 'absent'], ['archive', 'ambiguous']]);
  } finally {
    actions._test.setLogger(previousLogger);
  }
});

test('global multi-selection wins over focused folder and ambiguous list roots', () => {
  const selectedOne = mailboxRow({ selected: 'true' });
  const selectedTwo = mailboxRow({ selected: 'true', label: 'Unread second', read: 'unread' });
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [selectedOne]);
  const secondList = new Node('div', { role: 'listbox', 'aria-label': 'Sent messages' }, [selectedTwo]);
  const folderItem = new Node('div', { role: 'treeitem', 'aria-label': 'Inbox' });
  const tree = new Node('div', { role: 'tree' }, [folderItem]);
  const document = documentWith(list, secondList, tree);
  assert.equal(actions.resolveContext(document, eventAt(folderItem)), 'multi-selection');
  assert.equal(actions.createOutlookActions({ replayShortcut: () => true })
    .escapeContext(document, eventAt(folderItem)), true);
  assert.equal(selectedOne.children[0].clickCount, 1);
  assert.equal(selectedTwo.children[0].clickCount, 1);
});

test('selection filters use semantic tri-state row state and never subject text', () => {
  const read = mailboxRow({ label: 'Read item', read: 'read' });
  const unread = mailboxRow({ label: 'Unread item', read: 'unread' });
  const flagged = mailboxRow({ label: 'Flagged item', read: 'unknown', flagged: true });
  const unflagged = mailboxRow({ label: 'Unflagged item', read: 'unknown', flagged: false });
  const unknown = mailboxRow({ label: 'Item', read: 'unknown' });
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [read, unread, flagged, unflagged, unknown]);
  const document = documentWith(list);
  assert.equal(actions.selectRead(document), true);
  assert.equal(actions.selectUnread(document), true);
  assert.equal(actions.selectStarred(document), true);
  assert.equal(actions.selectUnstarred(document), true);
  assert.equal(read.children[0].clickCount, 1);
  assert.equal(unread.children[0].clickCount, 1);
  assert.equal(flagged.children[0].clickCount, 1);
  assert.equal(unflagged.children[0].clickCount, 1);
  assert.equal(unknown.children[0].clickCount, 0);
});

test('conversation controls and label are limited to active reading or command toolbar scopes', () => {
  const firstPrevious = new Node('button', { 'aria-label': 'Previous message' });
  const secondPrevious = new Node('button', { 'aria-label': 'Previous message' });
  const first = new Node('div', { role: 'region', 'aria-label': 'Message reading pane' }, [firstPrevious]);
  const second = new Node('div', { role: 'region', 'aria-label': 'Message reading pane' }, [secondPrevious]);
  const vim = actions.createOutlookActions({ replayShortcut: () => true });
  assert.equal(vim.previousConversationMessage(documentWith(first, second), eventAt(firstPrevious)), true);
  assert.equal(firstPrevious.clickCount, 1);
  assert.equal(secondPrevious.clickCount, 0);
  assert.equal(vim.previousConversationMessage(documentWith(first, second), eventAt(new Node('button'))), false);

  const label = new Node('button', { 'aria-label': 'Categories/Label' });
  const undo = new Node('button', { 'aria-label': 'Undo' });
  const redo = new Node('button', { 'aria-label': 'Redo' });
  const compose = new Node('button', { 'aria-label': 'New mail' });
  const toolbar = new Node('div', { role: 'toolbar' }, [compose, label, undo, redo]);
  assert.equal(vim.label(documentWith(toolbar), eventAt(label)), true);
  assert.equal(vim.undoContext(documentWith(toolbar), eventAt(undo)), true);
  assert.equal(vim.redoContext(documentWith(toolbar), eventAt(redo)), true);
  assert.equal(label.clickCount, 1);
  assert.equal(undo.clickCount, 1);
  assert.equal(redo.clickCount, 1);
});

test('guarded and unresolved contexts reject mailbox actions and escape only passes through guarded UI', () => {
  const guarded = new Node('div', { role: 'dialog' }, [new Node('button', { 'aria-label': 'Archive' })]);
  const unresolved = documentWith(new Node('div', { role: 'main' }, [new Node('button', { 'aria-label': 'Archive' })]));
  const vim = actions.createOutlookActions({ replayShortcut: () => { throw new Error('unexpected replay'); } });
  assert.equal(vim.escapeContext(documentWith(guarded), eventAt(guarded.children[0])), 'pass-through');
  assert.equal(vim.escapeContext(unresolved, eventAt(unresolved.querySelector('[role="main"]'))), false);
  assert.equal(vim.nextPage(unresolved, eventAt(unresolved.querySelector('[role="main"]'))), false);
  assert.equal(vim.archive(unresolved, eventAt(unresolved.querySelector('[role="main"]'))), false);
});

test('row checkbox safety diagnoses absent, ambiguous, disabled, and preserves checked rows', () => {
  const missing = mailboxRow({ read: 'read' });
  missing.children = [];
  const duplicate = mailboxRow({ read: 'unread' });
  duplicate.children.push(new Node('input', { type: 'checkbox' }));
  const disabled = mailboxRow({ read: 'read' });
  disabled.children[0].attributes.disabled = '';
  const checked = mailboxRow({ read: 'read', selected: 'true' });
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [missing, duplicate, disabled, checked]);
  const entries = [];
  const previousLogger = actions._test.setLogger({ debug: (...args) => entries.push(args) });
  try {
    assert.equal(actions.selectRead(documentWith(list)), false);
    assert.equal(checked.children[0].clickCount, 0);
    assert.deepEqual(entries, [['selectRead', 'absent']]);
    entries.length = 0;
    assert.equal(actions.selectUnread(documentWith(list)), false);
    assert.deepEqual(entries, [['selectUnread', 'ambiguous']]);
  } finally {
    actions._test.setLogger(previousLogger);
  }
});

test('guarded detection follows composed paths through shadow hosts and search ambiguity is diagnosed', () => {
  const shadowHost = new Node('div', { role: 'search' });
  const shadowTarget = new Node('button', { 'aria-label': 'Archive' });
  const vim = actions.createOutlookActions({ replayShortcut: () => true });
  assert.equal(vim.archive(documentWith(shadowHost), eventAt(shadowTarget, [shadowTarget, shadowHost])), false);

  const searchButton = new Node('button', { 'aria-label': 'Search' });
  const first = new Node('input', { role: 'textbox' });
  const second = new Node('input', { role: 'textbox' });
  const search = new Node('div', { role: 'search' }, [searchButton, first, second]);
  const entries = [];
  const previousLogger = actions._test.setLogger({ debug: (...args) => entries.push(args) });
  try {
    assert.equal(actions.search(documentWith(search)), true);
    assert.deepEqual(entries.at(-1), ['search', 'ambiguous']);
  } finally {
    actions._test.setLogger(previousLogger);
  }
});

test('every Task 1 mailbox binding resolves to a callable action', () => {
  const { MAILBOX_BINDINGS } = require('../../app/browser/tools/vimMailboxKeymap');
  const missing = [...new Set(MAILBOX_BINDINGS.map(({ action }) => action))]
    .filter(action => typeof actions[action] !== 'function');
  assert.deepEqual(missing, []);
});

test('readContext replays markUnread for a semantically read selected row', () => {
  const read = mailboxRow({ selected: 'true', label: 'Read message' });
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [read]);
  const calls = [];
  const vim = actions.createOutlookActions({ replayShortcut: id => { calls.push(id); return true; } });
  assert.equal(vim.readContext(documentWith(list), eventAt(read)), true);
  assert.deepEqual(calls, ['markUnread']);
});

test('moveRight opens a selected row and moveLeft collapses an expanded conversation', () => {
  const row = mailboxRow({ selected: 'true' });
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [row]);
  const vim = actions.createOutlookActions({ replayShortcut: () => true });
  assert.equal(vim.moveRight(documentWith(list), eventAt(row)), true);
  assert.equal(row.clickCount, 1);
  const disclosure = new Node('button', { 'aria-expanded': 'true' });
  const expanded = mailboxRow({ selected: 'true' });
  expanded.children.push(disclosure);
  disclosure.parentElement = expanded;
  const expandedList = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [expanded]);
  assert.equal(vim.moveLeft(documentWith(expandedList), eventAt(expanded)), true);
  assert.equal(disclosure.clickCount, 1);
});

test('conversation navigation uses semantic adjacent message fallback in one reading region', () => {
  const first = new Node('div', { role: 'article' });
  const second = new Node('div', { role: 'article' });
  const region = new Node('div', { role: 'region', 'aria-label': 'Conversation view' }, [first, second]);
  const document = documentWith(region);
  document.activeElement = first;
  const vim = actions.createOutlookActions({ replayShortcut: () => true });
  assert.equal(vim.nextConversationMessage(document, eventAt(first)), true);
  assert.equal(second.clickCount, 1);
});

test('destination aliases reject absent and ambiguous tree items', () => {
  assert.equal(actions.starred(documentWith(new Node('div', { role: 'tree' }))), false);
  const first = new Node('div', { role: 'treeitem', 'aria-label': 'Flagged' });
  const second = new Node('div', { role: 'treeitem', 'aria-label': 'Flagged' });
  assert.equal(actions.starred(documentWith(new Node('div', { role: 'tree' }, [first, second]))), false);
  assert.equal(first.clickCount + second.clickCount, 0);
});

test('disabled and aria-disabled checkboxes are untouched and diagnosed independently', () => {
  for (const attribute of ['disabled', 'aria-disabled']) {
    const row = mailboxRow({ read: 'read' });
    row.children[0].attributes[attribute] = attribute === 'aria-disabled' ? 'true' : '';
    const entries = [];
    const previousLogger = actions._test.setLogger({ debug: (...args) => entries.push(args) });
    try {
      assert.equal(actions.selectRead(documentWith(new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [row]))), false);
      assert.equal(row.children[0].clickCount, 0);
      assert.deepEqual(entries, [['selectRead', 'absent']]);
    } finally {
      actions._test.setLogger(previousLogger);
    }
  }
});

test('already checked matching rows are skipped without toggling or diagnostics', () => {
  const row = mailboxRow({ read: 'read', selected: 'true' });
  assert.equal(actions.selectRead(documentWith(
    new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [row]),
  )), false);
  assert.equal(row.children[0].clickCount, 0);
});

test('escape clears mailbox multi-selection but never checks unrelated picker or dialog lists', () => {
  const mailboxFirst = mailboxRow({ read: 'read', selected: 'true' });
  const mailboxSecond = mailboxRow({ read: 'unread', selected: 'true' });
  const mailbox = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [mailboxFirst, mailboxSecond]);
  const pickerCheckbox = new Node('input', { type: 'checkbox', 'aria-checked': 'true' });
  pickerCheckbox.checked = true;
  const picker = new Node('div', { role: 'listbox', 'aria-label': 'People picker' }, [
    new Node('div', { role: 'option' }, [pickerCheckbox]),
  ]);
  const dialog = new Node('div', { role: 'dialog' }, [picker]);
  const vim = actions.createOutlookActions({ replayShortcut: () => true });
  assert.equal(vim.escapeContext(documentWith(mailbox, dialog), eventAt(mailboxFirst)), true);
  assert.equal(mailboxFirst.children[0].clickCount, 1);
  assert.equal(mailboxSecond.children[0].clickCount, 1);
  assert.equal(pickerCheckbox.clickCount, 0);
});

test('does not infer row state from subject-style aria labels', () => {
	for (const subject of ['Read this tomorrow', 'flagged topic']) {
		const row = mailboxRow({ label: subject, selected: 'true', read: 'unknown' });
		const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [row]);
		const calls = [];
		const vim = actions.createOutlookActions({ replayShortcut: id => { calls.push(id); return true; } });
		assert.equal(vim.readContext(documentWith(list), eventAt(row)), false);
		assert.deepEqual(calls, []);
	}
});

test('uses dedicated row state attributes for read and flag filters', () => {
	const read = mailboxRow({ label: 'Read this tomorrow', read: 'unknown' });
	read.attributes['data-read-state'] = 'read';
	const flagged = mailboxRow({ label: 'flagged topic', read: 'unknown' });
	flagged.attributes['data-flag-state'] = 'flagged';
	const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [read, flagged]);
	assert.equal(actions.selectRead(documentWith(list)), true);
	assert.equal(actions.selectStarred(documentWith(list)), true);
	assert.equal(read.children[0].clickCount, 1);
	assert.equal(flagged.children[0].clickCount, 1);
});

test('reading q targets only the active individual message container', () => {
	const firstControl = new Node('button', { 'aria-label': 'Mark as unread' });
	const secondControl = new Node('button', { 'aria-label': 'Mark as unread' });
	const first = new Node('div', { role: 'article', 'data-message-id': 'first' }, [firstControl]);
	const second = new Node('div', { role: 'article', 'data-message-id': 'second' }, [secondControl]);
	const region = new Node('div', { role: 'region', 'aria-label': 'Conversation view' }, [first, second]);
	const document = documentWith(region);
	assert.equal(actions.createOutlookActions({ replayShortcut: () => true })
		.readContext(document, eventAt(secondControl)), true);
	assert.equal(firstControl.clickCount, 0);
	assert.equal(secondControl.clickCount, 1);
});

test('escape does not click Back or Close in calendar or unresolved contexts', () => {
	for (const region of [
		new Node('div', { role: 'region', 'aria-label': 'Calendar' }, [new Node('button', { 'aria-label': 'Back' })]),
		new Node('div', { role: 'main' }, [new Node('button', { 'aria-label': 'Close' })]),
	]) {
		const control = region.children[0];
		assert.equal(actions.createOutlookActions({ replayShortcut: () => true })
			.escapeContext(documentWith(region), eventAt(control)), false);
		assert.equal(control.clickCount, 0);
	}
});

test('message and list actions are rejected across unrelated contexts', () => {
	const folderControl = new Node('div', { role: 'treeitem', 'aria-label': 'Inbox' });
	const folder = new Node('div', { role: 'tree' }, [folderControl]);
  const vim = actions.createOutlookActions({ replayShortcut: () => true });
  for (const action of ['deleteMessage', 'permanentlyDeleteMessage', 'nextMessage', 'selectAll']) {
    assert.equal(vim[action](documentWith(folder), eventAt(folderControl)), false);
  }
  const reading = new Node('div', { role: 'region', 'aria-label': 'Message reading pane' });
  for (const action of ['nextMessage', 'previousMessage', 'selectAll']) {
    assert.equal(vim[action](documentWith(reading), eventAt(reading)), false);
  }
});

test('every mailbox binding has an explicit allowed-context matrix entry', () => {
  const { MAILBOX_BINDINGS } = require('../../app/browser/tools/vimMailboxKeymap');
  const missing = [...new Set(MAILBOX_BINDINGS.map(({ action }) => action))]
    .filter(action => !actions._test.allowedContexts[action]);
  assert.deepEqual(missing, []);
});

test('gn and gp reject folder contexts and replay in valid message contexts', () => {
  const folderControl = new Node('div', { role: 'treeitem', 'aria-label': 'Inbox' });
  const folder = new Node('div', { role: 'tree' }, [folderControl]);
  const calls = [];
  const vim = actions.createOutlookActions({ replayShortcut: id => { calls.push(id); return true; } });
  assert.equal(vim.nextPage(documentWith(folder), eventAt(folderControl)), false);
  assert.equal(vim.previousPage(documentWith(folder), eventAt(folderControl)), false);

  const row = mailboxRow({ selected: 'true' });
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [row]);
  assert.equal(vim.nextPage(documentWith(list), eventAt(row)), true);
  assert.equal(vim.previousPage(documentWith(list), eventAt(row)), true);
  assert.deepEqual(calls, ['pageDown', 'pageUp']);
});
