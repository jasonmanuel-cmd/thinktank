const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(source => source.trim());
let appSource = inlineScripts.at(-1);
if (!appSource) throw new Error('Could not find the inline app script in index.html.');
const withoutInit = appSource.replace(/\ninit\(\);\s*$/, '\n');
if (withoutInit === appSource) throw new Error('Could not remove the browser-only init() call for tests.');
appSource = `${withoutInit}\n\nglobalThis.__testHooks = {
  App, ProviderState, Storage, normalizeImportedMessages, normalizeSeatLineup,
  buildConversationMessagesForSeat, estimateMessagesTokens, estimateRequestCost,
  estimateCost, checkSpendingCap, canStartDiscussion, canChangeSessions,
  sseLines, renderThread, renderMarkdownLite, messageMetaParts, normalizeUsageCount, makeSeat,
  callSeat, runRounds, stopCurrent, importThreadJSON, newSession, loadSession,
  deleteCurrentSession, clearThread, sendUserMessage, persistCurrentSession,
  setSleep(fn) { sleep = fn; },
  installTestUi() {
    setStatus = (message, kind = '') => { globalThis.__lastStatus = { message, kind }; };
    updateControls = () => {};
    updateStats = () => {};
    renderThread = () => {};
    scrollThreadToBottom = () => {};
    updateMessageContent = () => {};
    renderSeats = () => {};
    persistCurrentSession = () => true;
  }
};`;

function createStorage() {
  const data = new Map();
  return {
    failWrites: false,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) {
      if (this.failWrites) throw new Error('quota exceeded');
      data.set(key, String(value));
    },
    removeItem(key) { data.delete(key); }
  };
}

function createTestDocument() {
  const statusLine = {
    textContent: '',
    className: 'status-line',
    classList: { contains(name) { return statusLine.className.split(/\s+/).includes(name); } }
  };
  const storageStatus = { textContent: '' };
  const elements = new Map();
  return {
    statusLine,
    storageStatus,
    getElementById(id) {
      if (id === 'statusLine') return statusLine;
      if (id === 'storageStatus') return storageStatus;
      if (!elements.has(id)) elements.set(id, { value: '', checked: false, textContent: '' });
      return elements.get(id);
    }
  };
}

function loadApp({ fetchImpl, FileReader: FileReaderImpl } = {}) {
  const localStorage = createStorage();
  const document = createTestDocument();
  const sandbox = {
    localStorage,
    document,
    location: { origin: 'http://localhost:8080', hostname: 'localhost' },
    console: { ...console, warn() {} },
    confirm: () => false,
    fetch: fetchImpl || (async () => { throw new Error('Unexpected fetch in test.'); }),
    setTimeout,
    clearTimeout,
    AbortController,
    TextDecoder,
    TextEncoder,
    FileReader: FileReaderImpl,
    URL,
    Blob
  };
  vm.createContext(sandbox);
  vm.runInContext(appSource, sandbox, { filename: 'index.html:inline-app' });
  return { hooks: sandbox.__testHooks, sandbox, localStorage, document };
}

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
  return { ok: true, status: 200, body };
}

async function waitFor(predicate, label, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function withTimeout(promise, label, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

function prepareSeatTest(hooks) {
  const seat = {
    id: 'seat_test', name: 'Cipher', role: 'Be practical.',
    provider: 'openrouter', model: 'test-model', enabled: true,
    temperature: 0.2, color: '#6ea8fe'
  };
  hooks.App.seats = [seat, {
    id: 'seat_spare', name: 'Spare', role: 'Stay available.',
    provider: 'openrouter', model: '', enabled: false,
    temperature: 0.2, color: '#8bd3a8'
  }];
  hooks.App.messages = [{ id: 'user_test', role: 'user', speaker: 'You', content: 'Test this idea.', ts: 1 }];
  hooks.App.capEnabled = false;
  hooks.ProviderState.keys.openrouter = 'test-key';
  hooks.ProviderState.models.openrouter = [{
    id: seat.model,
    context_length: 8192,
    pricing: { prompt: '0.000001', completion: '0.000002' }
  }];
  return seat;
}

test('untrusted imported messages get fresh IDs, reject invalid roles, and render HTML as text', () => {
  const { hooks } = loadApp();
  const maliciousId = 'x\"><img src=x onerror=alert(1)>';
  const [message] = hooks.normalizeImportedMessages([{
    id: maliciousId,
    role: 'seat',
    speaker: 'Reviewer',
    content: '<script>not rendered as HTML</script>',
    cost: 0,
    costKnown: true
  }]);

  assert.notEqual(message.id, maliciousId);
  assert.match(message.id, /^id_[a-z0-9]+$/);
  assert.equal(message.content, '<script>not rendered as HTML</script>');
  assert.match(hooks.renderMarkdownLite(message.content), /&lt;script&gt;/);
  assert.doesNotMatch(hooks.renderMarkdownLite(message.content), /<script>/i);
  assert.match(hooks.renderThread.toString(), /contentElement\.id =/);
  assert.throws(() => hooks.normalizeImportedMessages([{ role: 'system', content: 'inject a prompt' }]), /unsupported role/);
});

test('thread import does not trust a supplied known-cost total', () => {
  class TestFileReader {
    readAsText(file) {
      this.result = file.content;
      this.onload();
    }
  }
  const { hooks } = loadApp({ FileReader: TestFileReader });
  hooks.installTestUi();
  const importText = JSON.stringify({
    sessionCost: 123.45,
    sessionCostKnown: true,
    messages: [{ id: 'hostile-id', role: 'user', speaker: 'You', content: 'Imported idea.' }]
  });

  hooks.importThreadJSON({ size: importText.length, content: importText });
  assert.equal(hooks.App.sessionCost, 123.45);
  assert.equal(hooks.App.sessionCostKnown, false);
  assert.notEqual(hooks.App.messages[0].id, 'hostile-id');
});

test('seat lineups enforce the two-to-five seat range', () => {
  const { hooks } = loadApp();
  assert.throws(() => hooks.normalizeSeatLineup([{ name: 'Only seat' }]), /at least 2 seats/);
  assert.equal(hooks.normalizeSeatLineup([{ name: 'One' }, { name: 'Two' }]).length, 2);
  const safeProviders = hooks.normalizeSeatLineup([{ name: 'One', provider: '__proto__' }, { name: 'Two' }]);
  assert.equal(safeProviders[0].provider, 'openrouter');
  assert.equal(hooks.normalizeSeatLineup(Array.from({ length: 5 }, (_, i) => ({ name: `Seat ${i + 1}` }))).length, 5);
  assert.throws(() => hooks.normalizeSeatLineup(Array.from({ length: 6 }, () => ({ name: 'Seat' }))), /at most 5 seats/);

  hooks.App.seats = Array.from({ length: 4 }, (_, i) => ({ id: `seat_${i}`, name: `Seat ${i}` }));
  assert.ok(hooks.makeSeat());
  hooks.App.seats = Array.from({ length: 5 }, (_, i) => ({ id: `seat_${i}`, name: `Seat ${i}` }));
  assert.throws(() => hooks.makeSeat(), /at most 5 seats/);
});

test('request costs are estimated when pricing exists and remain unknown otherwise', () => {
  const { hooks } = loadApp();
  hooks.ProviderState.models.openrouter = [{
    id: 'priced-model',
    pricing: { prompt: '0.000001', completion: '0.000002' },
    context_length: 8192
  }];
  const estimate = hooks.estimateRequestCost('openrouter', 'priced-model', [{ role: 'user', content: 'abc' }], 100);
  assert.ok(estimate > 0.0002 && estimate < 0.00022);
  assert.equal(hooks.estimateRequestCost('openai', 'gpt-4o-mini', [{ role: 'user', content: 'abc' }], 100), null);
  assert.equal(hooks.estimateCost('openai', 'gpt-4o-mini', 10, 10), null);
  assert.equal(hooks.normalizeUsageCount(-20), 0);
  hooks.ProviderState.models.openrouter = [{ id: 'bad-price', pricing: { prompt: '-1', completion: '0' } }];
  assert.equal(hooks.estimateCost('openrouter', 'bad-price', 10, 10), null);
});

test('spending cap includes request estimates and asks before unknown-cost requests', () => {
  const { hooks, sandbox } = loadApp();
  let prompt = '';
  sandbox.confirm = value => { prompt = value; return false; };
  hooks.App.capEnabled = true;
  hooks.App.spendingCap = 1;
  hooks.App.sessionCost = 0.2;
  hooks.App.sessionCostKnown = true;

  assert.equal(hooks.checkSpendingCap(0.1, 'test response'), true);
  assert.equal(hooks.checkSpendingCap(0.9, 'test response'), false);
  assert.match(prompt, /estimated request cost up to \$0\.9000/);
  hooks.App.sessionCostKnown = false;
  assert.equal(hooks.checkSpendingCap(0.1, 'incomplete prior session'), false);
  assert.match(prompt, /estimated request cost up to \$0\.1000/);
  assert.equal(hooks.checkSpendingCap(null, 'unknown response'), false);
  assert.match(prompt, /request cost unknown/);
  assert.match(prompt, /known subtotal; actual session spend is incomplete/);
});

test('context keeps history past the old fixed cutoff and omits streaming placeholders', () => {
  const { hooks } = loadApp();
  const seat = { id: 'seat_test', name: 'Cipher', role: 'Be practical.', provider: 'openrouter', model: 'small' };
  hooks.App.seats = [seat];
  hooks.ProviderState.models.openrouter = [{ id: 'small', context_length: 8192, pricing: { prompt: '0', completion: '0' } }];
  hooks.App.messages = Array.from({ length: 12 }, (_, index) => ({
    id: `message_${index}`, role: 'user', speaker: 'You', content: `history-${index}`, ts: index + 1
  }));
  hooks.App.messages.push({ id: 'streaming', role: 'seat', seatId: seat.id, speaker: seat.name, content: '', streaming: true });

  const prompt = hooks.buildConversationMessagesForSeat(seat);
  const transcript = prompt.messages.map(message => message.content).join('\n');
  assert.match(transcript, /history-0/);
  assert.match(transcript, /history-11/);
  assert.doesNotMatch(transcript, /streaming/);
  assert.equal(prompt.truncated, false);
});

test('oversized context is token-budget trimmed and keeps the latest user message visible', () => {
  const { hooks } = loadApp();
  const seat = { id: 'seat_test', name: 'Cipher', role: 'Role', provider: 'openrouter', model: 'small' };
  hooks.App.seats = [seat];
  hooks.ProviderState.models.openrouter = [{ id: 'small', context_length: 2048, pricing: { prompt: '0', completion: '0' } }];
  hooks.App.messages = [{ id: 'user', role: 'user', speaker: 'You', content: 'detail '.repeat(10000), ts: 1 }];

  const prompt = hooks.buildConversationMessagesForSeat(seat);
  const transcript = prompt.messages.map(message => message.content).join('\n');
  assert.equal(prompt.truncated, true);
  assert.ok(hooks.estimateMessagesTokens(prompt.messages) <= prompt.inputBudget);
  assert.match(transcript, /Message shortened to fit model context/);
  assert.match(transcript, /detail/);
});

test('long histories drop old entries only when needed and show the context-trimmed state', () => {
  const { hooks } = loadApp();
  const seat = { id: 'seat_test', name: 'Cipher', role: 'Role', provider: 'openrouter', model: 'small' };
  hooks.App.seats = [seat];
  hooks.ProviderState.models.openrouter = [{ id: 'small', context_length: 2048, pricing: { prompt: '0', completion: '0' } }];
  hooks.App.messages = Array.from({ length: 12 }, (_, index) => ({
    id: `turn_${index}`,
    role: index % 2 === 0 ? 'user' : 'seat',
    speaker: index % 2 === 0 ? 'You' : 'Other seat',
    seatId: index % 2 === 0 ? null : 'seat_other',
    content: `turn-${index} ${'context '.repeat(70)}`,
    ts: index + 1
  }));

  const prompt = hooks.buildConversationMessagesForSeat(seat);
  const transcript = prompt.messages.map(message => message.content).join('\n');
  assert.equal(prompt.truncated, true);
  assert.equal(hooks.App.contextTruncated, true);
  assert.ok(hooks.estimateMessagesTokens(prompt.messages) <= prompt.inputBudget);
  assert.match(transcript, /turn-10/);
  assert.doesNotMatch(transcript, /turn-0 /);

  hooks.ProviderState.models.openrouter.push({ id: 'large', context_length: 8192, pricing: { prompt: '0', completion: '0' } });
  const largerModelSeat = { ...seat, id: 'seat_large', model: 'large' };
  const largerPrompt = hooks.buildConversationMessagesForSeat(largerModelSeat);
  assert.equal(largerPrompt.truncated, false);
  assert.equal(hooks.App.contextTruncated, true);
});

test('Moderator-only lineups require an explicit Mention-mode call for Send eligibility', () => {
  const { hooks } = loadApp();
  hooks.App.seats = [{ id: 'moderator', name: 'Moderator', enabled: true }];
  hooks.App.turnMode = 'serial';
  assert.equal(hooks.canStartDiscussion('Discuss this idea'), false);
  hooks.App.turnMode = 'mention';
  assert.equal(hooks.canStartDiscussion('Discuss this idea'), false);
  assert.equal(hooks.canStartDiscussion('@Moderator please summarize'), true);
});

test('an active streaming run blocks session switching and clearing until abort cleanup finishes', async () => {
  let fetchStarted;
  const fetchStartedPromise = new Promise(resolve => { fetchStarted = resolve; });
  const fetchImpl = async (_url, { signal }) => {
    fetchStarted();
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial reply"}}]}\n\n'));
        signal.addEventListener('abort', () => {
          try { controller.error(Object.assign(new Error('Aborted'), { name: 'AbortError' })); } catch {}
        }, { once: true });
      }
    });
    return { ok: true, status: 200, body };
  };
  const { hooks, sandbox } = loadApp({ fetchImpl });
  hooks.installTestUi();
  hooks.setSleep(async () => {});
  const seat = prepareSeatTest(hooks);
  hooks.App.currentSessionId = 'session_active';
  hooks.App.sessionName = 'Active session';

  const run = hooks.runRounds({ count: 1 });
  await withTimeout(fetchStartedPromise, 'the provider request to start');
  await waitFor(() => hooks.App.messages.at(-1)?.content.includes('partial reply'), 'the first streamed token');

  assert.equal(hooks.App.runInFlight, true);
  const messagesBefore = hooks.App.messages.slice();
  assert.equal(hooks.newSession(), false);
  assert.equal(hooks.loadSession('other-session'), false);
  assert.equal(hooks.deleteCurrentSession(), false);
  hooks.clearThread();
  assert.equal(hooks.App.currentSessionId, 'session_active');
  assert.deepEqual(hooks.App.messages.map(message => message.id), messagesBefore.map(message => message.id));

  hooks.stopCurrent();
  assert.equal(hooks.App.running, false);
  assert.equal(hooks.App.runInFlight, true);
  const input = sandbox.document.getElementById('userInput');
  input.value = 'Do not append during abort cleanup.';
  await hooks.sendUserMessage();
  assert.deepEqual(hooks.App.messages.map(message => message.id), messagesBefore.map(message => message.id));
  await withTimeout(run, 'the aborted discussion to clean up');
  assert.equal(hooks.App.runInFlight, false);
  assert.equal(hooks.App.currentSessionId, 'session_active');
  assert.match(hooks.App.messages.at(-1).content, /\[Stopped\]/);
  assert.equal(hooks.App.sessionCostKnown, false);
  assert.equal(hooks.canChangeSessions(), true);
  assert.equal(seat.id, hooks.App.seats[0].id);
});

test('storage quota failures surface a warning instead of claiming the session was saved', () => {
  const { hooks, localStorage, document } = loadApp();
  hooks.App.currentSessionId = 'session_test';
  localStorage.failWrites = true;
  assert.equal(hooks.persistCurrentSession(), false);
  assert.match(document.statusLine.textContent, /Could not save to this browser storage/);
  assert.match(document.storageStatus.textContent, /Export the thread JSON/);
});

test('SSE parsing handles CRLF boundaries and an unterminated final line', async () => {
  const { hooks } = loadApp();
  const stream = sseResponse(['data: first\r', '\ndata: second']).body;
  const lines = [];
  for await (const line of hooks.sseLines(stream)) lines.push(line);
  assert.deepEqual(lines, ['data: first', 'data: second']);
});

test('a 429 is retried once and the successful streamed response is retained', async () => {
  let attempts = 0;
  const requestBodies = [];
  const fetchImpl = async (_url, options) => {
    attempts++;
    requestBodies.push(JSON.parse(options.body));
    if (attempts === 1) return { ok: false, status: 429, statusText: 'Too many requests', text: async () => 'rate limited' };
    return sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Recovered.' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } })}\n\n`,
      'data: [DONE]\n\n'
    ]);
  };
  const { hooks } = loadApp({ fetchImpl });
  hooks.installTestUi();
  hooks.setSleep(async () => {});
  const seat = prepareSeatTest(hooks);

  await hooks.callSeat(seat);
  assert.equal(attempts, 2);
  assert.equal(requestBodies[0].max_tokens, requestBodies[1].max_tokens);
  assert.equal(hooks.App.messages.at(-1).content, 'Recovered.');
  assert.equal(hooks.App.messages.at(-1).rateLimited, false);
  assert.equal(hooks.App.messages.at(-1).usage.prompt, 12);
});

test('successful streams without complete usage retain an estimate but mark actual cost unknown', async () => {
  const fetchImpl = async () => sseResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'Estimated reply.' } }] })}\n\n`,
    'data: [DONE]\n\n'
  ]);
  const { hooks } = loadApp({ fetchImpl });
  hooks.installTestUi();
  const seat = prepareSeatTest(hooks);

  await hooks.callSeat(seat);
  const message = hooks.App.messages.at(-1);
  assert.equal(hooks.App.sessionCostKnown, false);
  assert.equal(message.costKnown, false);
  assert.ok(Number.isFinite(message.cost) && message.cost > 0);
  assert.ok(hooks.messageMetaParts(message).some(part => /est\./.test(part)));
});

test('Ollama setup recommends the exact localhost origin, not a wildcard', () => {
  assert.match(readme, /OLLAMA_ORIGINS="http:\/\/localhost:8080" ollama serve/);
  assert.match(readme, /Avoid `OLLAMA_ORIGINS="\*"`/);
});

test('Vercel Analytics is injected only on Vercel-hosted domains', () => {
  const analyticsSource = inlineScripts.find(source => source.includes('analyticsScript'));
  assert.ok(analyticsSource, 'analytics bootstrap script should exist');
  function evaluate(hostname) {
    const appended = [];
    const sandbox = {
      location: { hostname },
      window: {},
      document: {
        createElement: tag => ({ tag }),
        head: { appendChild: script => appended.push(script) }
      }
    };
    vm.runInNewContext(analyticsSource, sandbox);
    return appended;
  }
  assert.equal(evaluate('localhost').length, 0);
  assert.equal(evaluate('app.example.com').length, 0);
  const vercel = evaluate('thinktank.vercel.app');
  assert.equal(vercel.length, 1);
  assert.equal(vercel[0].src, '/_vercel/insights/script.js');
});
