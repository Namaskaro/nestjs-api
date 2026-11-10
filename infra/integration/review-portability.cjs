const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');
const { createAiStub, summaryOutput } = require('./review-fixture.cjs');
const {
  publishedReviewWhere,
} = require('@/src/modules/reviews/review-publication');

function loadSummaryWithoutHost() {
  const filename = require.resolve(
    '@/src/modules/reviews/review-summary.model',
  );
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
    },
  });
  const exports = {};
  runInNewContext(
    outputText,
    {
      exports,
      require(id) {
        assert.ok(
          ['node:crypto', 'zod'].includes(id),
          `Summary core imported a host dependency: ${id}`,
        );
        return require(id);
      },
    },
    { filename, timeout: 1000 },
  );
  return exports;
}

// A test-only second source with independent IDs and a different record shape.
function fromJsonLines(source) {
  const seen = new Set();
  return source.split('\n').flatMap((line) => {
    const { item, revision, body, visibility } = JSON.parse(line);
    if (
      visibility !== 'visible' ||
      !item ||
      !revision ||
      typeof body !== 'string' ||
      !body.trim() ||
      seen.has(item)
    )
      return [];
    seen.add(item);
    return [{ id: item, publicationId: revision, text: body, kind: 'review' }];
  });
}

async function summaryPortability({ db }, f) {
  const core = loadSummaryWithoutHost();
  const prismaSource = async () => {
    const rows = await db.review.findMany({
      where: { ...publishedReviewWhere, productId: f.corpus },
      orderBy: { publishedAt: 'asc' },
      select: { id: true, publicationId: true, text: true },
      take: 3,
    });
    return rows.map((row) => ({ ...row, kind: 'review' }));
  };
  const visible = await prismaSource();
  assert.equal(visible.length, 3);
  const otherShape = visible.map(({ text }, i) => ({
    item: `foreign:${i}`,
    revision: '1',
    body: text,
    visibility: 'visible',
  }));
  const alternate = () =>
    fromJsonLines(
      [
        ...otherShape,
        otherShape[0],
        {
          item: 'hidden',
          revision: '1',
          body: 'non-public',
          visibility: 'deleted',
        },
        { revision: '1', body: 'missing identity', visibility: 'visible' },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n'),
    );

  for (const load of [prismaSource, alternate]) {
    const input = await load();
    assert.equal(input.length, 3);
    const ai = createAiStub();
    let leaseChecks = 0;
    const result = await core.generateReviewSummary(ai, input, {
      inputTokenBudget: 6000,
      maxCalls: 4,
      signal: new AbortController().signal,
      checkLease: async () => {
        leaseChecks++;
      },
    });
    assert.equal(result.calls, 1);
    assert.deepEqual(result.output, summaryOutput);
    assert.equal(leaseChecks, 2);
    const prompt = ai.modelCalls[0].messages[1].content;
    for (const { text } of visible) assert.ok(prompt.includes(text));
    assert.doesNotMatch(prompt, /non-public|missing identity/);
    assert.equal(core.nextReviewSummaryCount(100), 110);
    assert.equal(core.isReviewSummaryMilestone(100, 109), false);
    assert.equal(core.isReviewSummaryMilestone(100, 110), true);
  }
}

module.exports = { summaryPortability };
