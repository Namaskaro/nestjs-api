// Read-only audit of the local guest_qdrant endpoint from docker-compose.yml.
// No upserts, collection creation, embedding calls, or payload/ID dumps.
const fs = require('node:fs');
const base = 'http://127.0.0.1:6333';
async function request(path, body) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    signal: AbortSignal.timeout(5000),
    ...(body
      ? {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(`Qdrant HTTP ${response.status}: ${JSON.stringify(data)}`);
  return data.result ?? data;
}
(async () => {
  const output = {
    endpoint: base,
    observedAt: new Date().toISOString(),
    server: await request('/'),
    collections: {},
  };
  const available = await request('/collections');
  for (const name of ['products', 'store_knowledge']) {
    if (!available.collections.some((collection) => collection.name === name)) {
      output.collections[name] = { present: false };
      continue;
    }
    const info = await request(`/collections/${name}`);
    const counts = {
      points: 0,
      dense: 0,
      sparse: 0,
      nonemptySparse: 0,
      denseDimensions: {},
      completeScan: false,
    };
    let offset;
    do {
      const page = await request(`/collections/${name}/points/scroll`, {
        limit: 128,
        with_payload: false,
        with_vector: true,
        ...(offset != null ? { offset } : {}),
      });
      for (const point of page.points) {
        counts.points++;
        if (Array.isArray(point.vector?.dense)) {
          counts.dense++;
          const size = point.vector.dense.length;
          counts.denseDimensions[size] =
            (counts.denseDimensions[size] ?? 0) + 1;
        }
        if (point.vector?.bm25?.indices) {
          counts.sparse++;
          if (point.vector.bm25.indices.length) counts.nonemptySparse++;
        }
      }
      offset = page.next_page_offset;
    } while (offset != null && counts.points < 10000);
    counts.completeScan = offset == null;
    const query = name === 'products' ? 'кроссовки' : 'доставка';
    const results = await request(`/collections/${name}/points/query`, {
      query: { text: query, model: 'qdrant/bm25' },
      using: 'bm25',
      limit: 5,
      with_payload: false,
    });
    const filtered = await request(`/collections/${name}/points/query`, {
      query: { text: query, model: 'qdrant/bm25' },
      using: 'bm25',
      limit: 5,
      with_payload: false,
      filter: {
        must: [
          { key: '__audit_nonexistent_field__', match: { value: 'never' } },
        ],
      },
    });
    output.collections[name] = {
      present: true,
      config: info.config.params,
      counts,
      sparseOnly: {
        query,
        returned: results.points.length,
        positiveScores: results.points.filter((point) => point.score > 0)
          .length,
        impossibleFilterReturned: filtered.points.length,
      },
    };
  }
  fs.mkdirSync('.tmp/provider-research', { recursive: true });
  fs.writeFileSync(
    '.tmp/provider-research/qdrant-readonly.json',
    JSON.stringify(output, null, 2),
  );
  console.log(JSON.stringify(output, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
