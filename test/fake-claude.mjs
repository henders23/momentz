// A stand-in for the Claude API, so the tests run without a key or a network.
// It speaks just enough of POST /v1/messages (streaming and not) to play a
// scripted coach, and it rejects conversations the real API would reject.

import http from 'node:http';

const PLACES = ['Timing', 'How ready the idea felt', 'Finding the words'];

export const SUMMARY = {
  short_title: 'Week 6 seminar',
  category: 'Seminars',
  what_happened: "Prepared on remittances; others kept getting in first, and it felt too late.",
  expected_vs_happened: 'Prepared, but silent',
  what_got_in_the_way: 'a proper argument with evidence, or it is not worth saying',
  when: 'someone says something I agree with',
  will: 'say "building on that" straight away',
  action_title: "Build on, don't wait",
  try_at: 'Week 7 seminar',
  phrases: ['Building on that, I think…'],
  own_words: ['Prepared, but silent', 'something the student never said']
};

/** The coach's scripted reply, chosen by how far the conversation has got. */
function script(body) {
  const turn = body.messages.filter((m) => m.role === 'user').length;
  const tools = (body.tools || []).map((t) => t.name);
  const last = body.messages.at(-1);
  const result = Array.isArray(last.content) && last.content.find((b) => b.type === 'tool_result');
  if (result) return { text: `Tool said: ${result.content}` };
  if (turn === 1) return { text: 'Before you walked in, what did you expect would happen?' };
  if (turn === 2) return { text: 'People often start looking in one of these places.', tool: { name: 'offer_places_to_look', input: { places: PLACES } } };
  if (tools.includes('offer_earlier_moments') && !JSON.stringify(body.messages).includes('"offer_earlier_moments"')) {
    return { text: 'Want to see if this has come up before?', tool: { name: 'offer_earlier_moments', input: {} } };
  }
  return { text: 'That sounds like yours.', tool: { name: 'offer_wrap_up', input: {} } };
}

/** The rules the real API enforces on a conversation with tools. */
function problem(body) {
  const { messages } = body;
  if (!messages?.length || messages[0].role !== 'user') return 'first message must be from the user';
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (i && m.role === messages[i - 1].role) return `two ${m.role} messages in a row at ${i}`;
    if (m.role !== 'assistant') continue;
    if (!Array.isArray(m.content) || m.content[0]?.type !== 'thinking' || !m.content[0].signature) {
      return `assistant message ${i} was not sent back unchanged (thinking block missing)`;
    }
    const uses = m.content.filter((b) => b.type === 'tool_use').map((b) => b.id);
    if (!uses.length) continue;
    const next = messages[i + 1];
    if (!next) return `tool_use at ${i} has no tool_result`;
    const results = Array.isArray(next.content) ? next.content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id) : [];
    if (uses.join() !== results.join()) return `tool_use at ${i} is not answered by tool_result blocks`;
    if (next.content[0].type !== 'tool_result') return 'tool_result blocks must come first';
  }
  return null;
}

export function startFakeClaude() {
  const requests = [];
  let failNext = null;
  let counter = 0;

  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    requests.push({ url: req.url, headers: req.headers, body });
    const json = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    if (failNext) {
      const status = failNext;
      failNext = null;
      return json(status, { type: 'error', error: { type: 'api_error', message: 'scripted failure' } });
    }
    const bad = problem(body);
    if (bad) return json(400, { type: 'error', error: { type: 'invalid_request_error', message: bad } });

    const base = { id: `msg_${++counter}`, type: 'message', role: 'assistant', model: body.model, stop_sequence: null, stop_details: null };
    const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

    if (!body.stream) {
      // The two structured-output calls: the summary and "help me say it".
      const schema = JSON.stringify(body.output_config?.format ?? {});
      const output = schema.includes('suggestions') ? { suggestions: ['What stopped me was…', 'I think it was…', 'In that second, I…'] } : SUMMARY;
      return json(200, { ...base, content: [{ type: 'text', text: JSON.stringify(output) }], stop_reason: 'end_turn', usage });
    }

    const { text, tool } = script(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (data) => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
    send({ type: 'message_start', message: { ...base, content: [], stop_reason: null, usage } });
    send({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
    send({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: `sig_${counter}` } });
    send({ type: 'content_block_stop', index: 0 });
    send({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } });
    for (const word of text.split(/(?<= )/)) {
      send({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: word } });
      await new Promise((r) => setTimeout(r, 5));
    }
    send({ type: 'content_block_stop', index: 1 });
    if (tool) {
      send({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: `toolu_${counter}`, name: tool.name, input: {} } });
      send({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } });
      send({ type: 'content_block_stop', index: 2 });
    }
    send({ type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
    send({ type: 'message_stop' });
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        failNextWith: (status) => (failNext = status),
        close: () => server.close()
      });
    });
  });
}

// `node test/fake-claude.mjs` runs it on its own, for trying the app by hand.
if (import.meta.url === `file://${process.argv[1]}`) {
  const fake = await startFakeClaude();
  console.log(`Fake Claude API on ${fake.url}\nStart the app with: ANTHROPIC_BASE_URL=${fake.url} ANTHROPIC_API_KEY=test npm start`);
}
