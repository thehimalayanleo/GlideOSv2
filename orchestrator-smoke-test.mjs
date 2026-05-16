import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('./orchestrator-v4.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

const elements = new Map();
function makeElement(id = '') {
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    style: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild() {},
    setAttribute() {},
    getAttribute() { return ''; },
  };
}

const context = {
  console,
  Date,
  Math,
  setInterval() { return 1; },
  clearInterval() {},
  setTimeout(fn) { fn(); return 1; },
  localStorage: { getItem() { return ''; }, setItem() {} },
  prompt() { return ''; },
  alert() {},
  URL: { createObjectURL() { return ''; } },
  Audio: function Audio() { return { play() {}, pause() {} }; },
  fetch: async () => ({ ok: true, json: async () => ({ days: [] }), blob: async () => ({}) }),
  Notification: { permission: 'denied', requestPermission() {} },
  document: {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    createElement(tag) {
      return { ...makeElement(), tagName: tag, onclick: null };
    },
  },
  window: {},
};
context.window = context;

vm.createContext(context);
vm.runInContext(`${script}
globalThis.__orch = {
  GUESTS,
  setRole(role){ selectedRole = role; },
  getShiftTPs(){ return shiftTPs; },
  rebuildShiftTPs,
  classifyIntent,
  applyIntent,
  setOrchTarget(target){ orchSelectedGuestId = target; },
  getOrchTarget(){ return orchSelectedGuestId; },
  runOrchText(text){
    document.getElementById('orch-inp').value = text;
    runOrch();
    return {
      pendingDiff,
      summary: document.getElementById('diff-summary').textContent,
      count: document.getElementById('diff-count').textContent,
    };
  },
  approve(diff){ pendingDiff = diff; approveDiff(); },
};`, context);

const orch = context.__orch;
const activeBefore = orch.GUESTS.length;
if (activeBefore < 2) throw new Error('seed guests missing');

orch.setRole('Spa');
orch.rebuildShiftTPs();
const spaItems = orch.getShiftTPs();
if (!spaItems.length) throw new Error('future Spa predicted touchpoint was skipped');
if (spaItems.some(item => item.tp.type !== 'predicted')) throw new Error('shift queue contains non-predicted touchpoints');
if (!spaItems.some(item => item.dayStatus === 'future')) throw new Error('future shift metadata missing');

const intents = orch.classifyIntent('Bring Tanaka car around at 18:00');
const changes = [];
intents.forEach(intent => orch.applyIntent(intent, changes));
if (!changes.some(change => change.kind === 'new_touchpoint')) throw new Error('valet instruction did not propose a new touchpoint');

const tanaka = orch.GUESTS.find(g => g.name.includes('Tanaka'));
const vasquez = orch.GUESTS.find(g => g.name.includes('Vasquez'));
const currentVisit = tanaka.visits.find(v => v.status === 'current');
const valetBefore = currentVisit.days.flatMap(day => day.touchpoints).filter(tp => tp.source === 'Valet').length;
const valetAfterProposal = currentVisit.days.flatMap(day => day.touchpoints).filter(tp => tp.source === 'Valet').length;
if (valetAfterProposal !== valetBefore) throw new Error('new Valet touchpoint inserted before approval');

orch.approve({ summary: 'test', changes });
const valetAfterApprove = currentVisit.days.flatMap(day => day.touchpoints).filter(tp => tp.source === 'Valet').length;
if (valetAfterApprove !== valetBefore + 1) throw new Error('new Valet touchpoint was not inserted on approval');

orch.setOrchTarget(null);
const untargeted = orch.runOrchText('Bring car around at 18:00');
if (untargeted.pendingDiff) throw new Error('untargeted guest-specific command generated a diff');
if (!untargeted.summary.includes('Choose a guest first')) throw new Error('untargeted command did not ask for a guest');

orch.setOrchTarget(tanaka.id);
const targeted = orch.runOrchText('Bring car around at 18:00');
if (!targeted.pendingDiff || !targeted.pendingDiff.changes.some(change => (change.guestId === tanaka.id) || (change.scope || '').includes('Tanaka'))) {
  throw new Error('selected guest was not used as orchestrator target');
}

orch.setOrchTarget('ALL');
const allTargeted = orch.runOrchText('Bring car around at 18:00');
const allScopes = allTargeted.pendingDiff.changes.map(change => change.scope || '').join(' ');
if (!allScopes.includes('Tanaka') || !allScopes.includes('Vasquez')) {
  throw new Error('All guests did not apply to every active guest');
}

console.log('orchestrator smoke ok');
