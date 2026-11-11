// Self-check for the parts that can run without a mic or API key: node test.js
const assert = require('assert');
const { definitions, runTool } = require('./tools');

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
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
