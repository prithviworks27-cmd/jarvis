// Self-check for the parts that can run without a mic or API key: node test.js
const assert = require('assert');
const { definitions, runTool } = require('./tools');

(async () => {
  assert.ok(definitions.length >= 10 && definitions.every((d) => d.function.name));
  assert.match(await runTool('open_url', { url: 'file:///etc/passwd' }), /^Error: Only http/);
  assert.match(await runTool('nope', {}), /^Error: Unknown tool/);
  assert.strictEqual(await runTool('set_clipboard', { text: 'jarvis-test' }), 'Copied.');
  assert.strictEqual(await runTool('get_clipboard', {}), 'jarvis-test');
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
