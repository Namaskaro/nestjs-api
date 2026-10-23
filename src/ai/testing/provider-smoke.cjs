// Opt-in PAID check, never imported by application/Jest. No DB/indexing/tools with side effects.
// Load your environment before launching (Node --env-file is supported).
// node --env-file=<private-file> src/ai/testing/provider-smoke.cjs --live
if (!process.argv.includes('--live') || process.env.ALLOW_PAID_LLM_SMOKE !== '1') {
  console.error('Not run: live smoke requires --live AND ALLOW_PAID_LLM_SMOKE=1 after explicit cost approval.');
  process.exitCode = 2;
} else {
  require('ts-node/register/transpile-only');
  process.env.LANGSMITH_TRACING = 'false';
  process.env.LANGCHAIN_TRACING_V2 = 'false';
  const assert = require('node:assert/strict');
  const { z } = require('zod');
  const { tool } = require('@langchain/core/tools');
  const { HumanMessage, ToolMessage } = require('@langchain/core/messages');
  const { AiService } = require('../ai.service.ts');
  const { Logger } = require('@nestjs/common');
  Logger.overrideLogger(false);
  const schema = z.object({ value: z.string() });
  const probe = tool(async () => 'pong', {
    name: 'smoke_ping', description: 'Return pong; no side effects.', schema: z.object({}),
  });
  const ai = new AiService({ get: (key) => process.env[key] });
  async function run() {
    let calls = 0;
    const usage = [];
    for (const role of ['FAST', 'STANDARD']) {
      const model = ai.getChatModel(role);
      // Keep production transport settings. Short prompts are not a hard token cap.
      const invoke = async (runnable, input) => {
        calls++;
        const answer = await runnable.invoke(input);
        const raw = answer.raw ?? answer;
        usage.push({ role, usage: raw.usage_metadata ?? null });
        return answer;
      };
      assert.ok((await invoke(model, 'Reply with OK.')).content);
      for (const method of ['functionCalling', 'jsonSchema', 'jsonMode']) {
        const answer = await invoke(model.withStructuredOutput(schema, { method, includeRaw: true }),
          'Return JSON with value equal to ok.');
        assert.deepEqual(schema.parse(answer.parsed), { value: 'ok' });
      }
      const history = [new HumanMessage('Call smoke_ping exactly once, then report its result.')];
      const first = await invoke(model.bindTools([probe], { tool_choice: 'smoke_ping' }), history);
      assert.equal(first.tool_calls?.length, 1);
      assert.equal(first.tool_calls[0].name, 'smoke_ping');
      const result = await probe.invoke(first.tool_calls[0].args);
      history.push(first, new ToolMessage({ content: result, tool_call_id: first.tool_calls[0].id }));
      const last = await invoke(model.bindTools([probe], { tool_choice: 'none' }), history);
      assert.equal(last.tool_calls?.length ?? 0, 0);
      assert.ok(last.content);
    }
    console.log(JSON.stringify({ calls, usage }, null, 2));
  }
  run().catch((error) => {
    // SDK errors can contain request headers; never dump the whole object.
    console.error(JSON.stringify({ name: error.name, status: error.status ?? null, code: error.code ?? null }));
    process.exitCode = 1;
  });
}
