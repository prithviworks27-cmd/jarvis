// Self-check for the parts that can run without a mic or API key: node test.js
const assert = require('assert');
const { definitions, runTool } = require('./tools');

const runWith = (c, name, args) => c.tools[name].run(args).then((r) => r, (e) => e.message);

(async () => {
  assert.ok(definitions.length >= 10 && definitions.every((d) => d.function.name));
  assert.match(await runTool('open_url', { url: 'file:///etc/passwd' }), /^Error: Only http/);
  assert.match(await runTool('nope', {}), /^Error: Unknown tool/);
  assert.strictEqual(await runTool('set_clipboard', { text: 'jarvis-test' }), 'Copied.');
  assert.strictEqual(await runTool('get_clipboard', {}), 'jarvis-test');
  // Safety rules in control.js (none of these send a real key or click)
  const { keyScript } = require('./control');
  assert.strictEqual(keyScript('cmd+f'), 'keystroke "f" using {command down}');
  assert.strictEqual(keyScript('Return'), 'key code 36');
  assert.throws(() => keyScript('cmd+"'), /Unknown key/);
  assert.throws(() => keyScript('hyper+a'), /Unknown modifier/);
  assert.match(await runTool('type_text', { text: 'a\nb' }), /^Error: Only single-line/);
  process.env.JARVIS_CONTROL_APPS = 'no-such-app';
  assert.match(await runTool('type_text', { text: 'x' }), /^Error: I am not allowed to control/);
  assert.match(await runTool('click_ui_element', { label: 'Send' }), /^CONFIRMATION REQUIRED/); // parked, not clicked
  const parked = require('./tools').takePending();
  assert.ok(parked && !require('./tools').takePending(), 'pending is single-use');
  const { pageClickScript } = require('./control');
  new Function(pageClickScript('Work "log" \\ - Nov', true)); // must be valid JS even for awkward labels
  assert.ok(pageClickScript('x', true).includes('dblclick') && !pageClickScript('x', false).includes('dblclick'));
  assert.ok(pageClickScript('x').includes('\\s+'), 'regex escapes must survive the template literal');
  assert.match(await runTool('open_app', { name: 'Definitely Not An App 12345' }), /^Error:/);
  // The risky-label guard is on the element that would be clicked, not on the request words.
  const runPage = (label, text, confirmed) => {
    const el = { clicked: false, getAttribute: () => label, innerText: label, getBoundingClientRect: () => ({ width: 5, height: 5, top: 0, bottom: 5 }), scrollIntoView() {}, click() { this.clicked = true; }, dispatchEvent() {} };
    const out = new Function('document', 'innerHeight', 'MouseEvent', `return ${pageClickScript(text, false, confirmed)}`)({ querySelectorAll: () => [el] }, 800, class {});
    return { out, clicked: el.clicked };
  };
  assert.deepStrictEqual(runPage('Delete account', 'account', false), { out: 'RISKY delete account', clicked: false });
  assert.deepStrictEqual(runPage('Delete account', 'account', true), { out: 'CLICKED delete account', clicked: true });
  assert.deepStrictEqual(runPage('Open settings', 'settings', false), { out: 'CLICKED open settings', clicked: true });
  // A parked Return only runs in the app it was asked about (fake osa: nothing real is pressed).
  let front = 'WhatsApp';
  const sent = [];
  const fakeOsa = async (script) => { if (script.includes('frontmost is true')) return front; sent.push(script); return ''; };
  process.env.JARVIS_CONTROL_APPS = 'WhatsApp,Google Chrome';
  const fake = require('./control')({ run: async () => '', osa: fakeOsa, fn: (name) => ({ function: { name } }) });
  assert.match(await fake.tools.press_keys.run({ keys: 'return' }), /^CONFIRMATION REQUIRED/);
  front = 'Google Chrome'; // the user moved before saying yes
  await assert.rejects(fake.takePending().run(), /moved to a different place/);
  assert.strictEqual(sent.length, 0, 'no key may be pressed in the wrong app');
  front = 'WhatsApp';
  await fake.tools.press_keys.run({ keys: 'return' });
  await fake.takePending().run();
  assert.strictEqual(sent.length, 1, 'the key is pressed once, in the right app');
  // Password-field rule in browsers: fail closed when the page cannot be asked (fake osa, nothing is typed).
  let field = 'text';
  const typed = [];
  const browserOsa = async (script) => {
    if (script.includes('frontmost is true')) return 'Google Chrome';
    if (script.includes('AXSubrole')) return '';
    if (script.includes('execute javascript')) { if (field === 'unavailable') throw new Error('Executing JavaScript through AppleScript is turned off.'); return field; }
    typed.push(script); return '';
  };
  const browser = require('./control')({ run: async () => '', osa: browserOsa, fn: (name) => ({ function: { name } }) });
  field = 'unavailable';
  assert.match(await runWith(browser, 'type_text', { text: 'x' }), /cannot tell whether/);
  field = 'password';
  assert.match(await runWith(browser, 'type_text', { text: 'x' }), /password field/);
  field = 'text';
  assert.strictEqual(await runWith(browser, 'type_text', { text: 'x' }), 'Typed.');
  assert.strictEqual(typed.length, 1, 'typed once, only into the ordinary box');

  // The brain: only the user's own "yes" runs a parked action, and "Silent Hill" keeps its word.
  const toolsPath = require.resolve('./tools');
  const realTools = require.cache[toolsPath];
  let yesParked = null;
  let ran = 0;
  require.cache[toolsPath] = { id: toolsPath, filename: toolsPath, loaded: true, exports: { definitions: [], runTool: async () => '', takePending: () => { const p = yesParked; yesParked = null; return p; } } };
  const brain = require('./brain');
  require.cache[toolsPath] = realTools;
  const realFetch = global.fetch;
  let modelSays = 'Hello, sir.';
  global.fetch = async () => ({ status: 200, ok: true, json: async () => ({ choices: [{ message: { content: modelSays } }] }) });
  try {
    yesParked = { run: async () => { ran++; return 'Pressed return.'; } };
    assert.strictEqual(await brain.ask('yes'), '');
    assert.strictEqual(ran, 1, 'a yes runs the parked action');
    yesParked = { run: async () => { ran++; return 'Pressed return.'; } };
    assert.strictEqual(await brain.ask('what time is it'), 'Hello, sir.');
    assert.strictEqual(ran, 1, 'anything else drops it without running');
    modelSays = 'Silent Hill was directed by Christophe Gans, sir.SILENT';
    assert.strictEqual(await brain.ask('who directed Silent Hill'), 'Silent Hill was directed by Christophe Gans, sir.');
  } finally {
    global.fetch = realFetch;
  }
  // Misheard names snap to real ones; made-up words do not snap to anything.
  const { closest } = require('./fuzzy');
  const apps = ['Safari', 'Claude', 'Google Chrome', 'WhatsApp', 'Spotify', 'Notes'];
  assert.strictEqual(closest('Clawed', apps), 'Claude');
  assert.strictEqual(closest('cloud', apps), 'Claude');
  assert.strictEqual(closest('watsapp', apps), 'WhatsApp');
  assert.strictEqual(closest('banana', apps), null);
  assert.strictEqual(closest('Risham', ['Rishabh', 'Setting']), 'Rishabh');
  assert.strictEqual(closest('Settings', ['Rishabh', 'Setting']), 'Setting');
  // The reply language follows the latest message, not earlier turns (the model sees this bracketed note).
  const seen = [];
  global.fetch = async (u, o) => { seen.push(JSON.parse(o.body).messages.at(-1).content); return { status: 200, ok: true, json: async () => ({ choices: [{ message: { content: 'ok, sir.' } }] }) }; };
  try {
    await brain.ask('Rishabh ka WhatsApp chat kholo');
    await brain.ask('What is the weather today?');
    await brain.ask('आज का मौसम बताओ');
  } finally {
    global.fetch = realFetch;
  }
  assert.match(seen[0], /Hindi/);
  assert.match(seen[1], /English/);
  assert.match(seen[2], /Hindi/);
  // Dictation text: trailing space, silence hallucinations are dropped.
  const { cleanDictation } = require('./dictate');
  assert.strictEqual(cleanDictation(' Hello world. '), 'Hello world. ');
  assert.strictEqual(cleanDictation('Thank you.'), '');
  assert.strictEqual(cleanDictation('   '), '');
  assert.strictEqual(cleanDictation('Thank you for the help.'), 'Thank you for the help. ');
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
