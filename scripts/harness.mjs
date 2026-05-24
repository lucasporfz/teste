import fs from 'node:fs';
import vm from 'node:vm';

function makeElement(id) {
  const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  return {
    id,
    value: '',
    checked: false,
    disabled: false,
    innerHTML: '',
    textContent: '',
    style: {},
    dataset: {},
    options: [],
    selectedIndex: 0,
    classList,
    addEventListener() {},
    appendChild() {},
    querySelector() { return null; },
    getContext() { return {}; }
  };
}

export function loadSimulator(entry = 'app/index.html') {
  const html = fs.readFileSync(entry, 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  const elements = new Map();
  const $el = id => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  class Chart {
    constructor(element, config) {
      this.element = element;
      this.config = config;
    }
    destroy() {}
  }
  Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } };

  const sandbox = {
    console,
    Math,
    Date,
    performance,
    setTimeout: fn => fn(),
    clearTimeout() {},
    Chart,
    document: {
      getElementById: $el,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: tag => makeElement(tag),
      addEventListener() {}
    },
    window: {
      addEventListener() {},
      requestAnimationFrame: fn => fn(),
      location: { hash: '', search: '' },
      history: { replaceState() {} }
    },
    navigator: {},
    Blob: function Blob() {},
    URL: { createObjectURL: () => '' },
    Worker: function Worker() {
      this.postMessage = () => {};
      this.terminate = () => {};
    },
    btoa: str => Buffer.from(str, 'binary').toString('base64'),
    URLSearchParams
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);

  for (let i = 0; i < scripts.length; i += 1) {
    const script = i === scripts.length - 1
      ? scripts[i].replace(/const hasUrlState = deserializeState\(\);[\s\S]*$/u, '')
      : scripts[i];
    vm.runInContext(script, sandbox, { timeout: 10000 });
  }

  return { sandbox, elements };
}
