import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const smokeCollection = 'support_integration_smoke';
const seedId = 'support-integration-seed-v1';
const seedPointIds = [
  'fe8203da-335d-4620-84ea-5d5c6bff0001',
  'fe8203da-335d-4620-84ea-5d5c6bff0002',
  'fe8203da-335d-4620-84ea-5d5c6bff0003',
];
const supportIssue = 'Synthetic integration support case';

async function ensureCollection(qdrant, name, config) {
  const path = `/collections/${name}`;
  let collection;
  try {
    collection = await qdrant('GET', path);
  } catch (error) {
    if (error.status !== 404) throw error;
    try {
      await qdrant('PUT', path, config);
    } catch (creationError) {
      // A concurrent provisioner may have created it after the GET.
      if (creationError.status !== 409) throw creationError;
    }
    collection = await qdrant('GET', path);
  }
  const params = collection.result.config.params;
  const vector = config.vectors.dense ? params.vectors?.dense : params.vectors;
  const expectedVector = config.vectors.dense ?? config.vectors;
  assert.equal(vector?.size, expectedVector.size, `${name}: vector size`);
  assert.equal(vector?.distance, expectedVector.distance, `${name}: vector distance`);
  if (config.sparse_vectors) {
    assert.equal(params.sparse_vectors?.bm25?.modifier, 'idf', `${name}: sparse modifier`);
  }
}

async function ensureSmokeCollection(qdrant) {
  await ensureCollection(qdrant, smokeCollection, {
    vectors: { size: 3, distance: 'Cosine' },
  });
}

export async function prepareCollections(qdrant) {
  for (const name of ['products', 'store_knowledge']) {
    await ensureCollection(qdrant, name, {
      vectors: { dense: { size: 768, distance: 'Cosine' } },
      sparse_vectors: { bm25: { modifier: 'idf' } },
    });
  }
  await ensureSmokeCollection(qdrant);
}

function vectors(scope, ids) {
  return [
    { id: ids[0], vector: [1, 0, 0], payload: { scope, tenant: 'private' } },
    { id: ids[1], vector: [0.8, 0.6, 0], payload: { scope, tenant: 'public' } },
    { id: ids[2], vector: [0, 1, 0], payload: { scope, tenant: 'public' } },
  ];
}

const smokePoints = `/collections/${smokeCollection}/points`;

async function upsertPoints(qdrant, points) {
  await qdrant('PUT', `${smokePoints}?wait=true`, { points });
}

async function deletePoints(qdrant, points) {
  await qdrant('POST', `${smokePoints}/delete?wait=true`, { points });
}

async function readPointIds(qdrant, ids) {
  const response = await qdrant('POST', smokePoints, { ids });
  return response.result.map((point) => point.id);
}

async function checkVectors(qdrant) {
  const scope = randomUUID();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const filter = { must: [{ key: 'scope', match: { value: scope } }] };
  const tenantFilter = {
    must: [...filter.must, { key: 'tenant', match: { value: 'public' } }],
  };
  const query = { query: [1, 0, 0], params: { exact: true }, limit: 3 };
  try {
    await upsertPoints(qdrant, vectors(scope, ids));
    const unfiltered = await qdrant('POST', `${smokePoints}/query`, { ...query, filter });
    assert.deepEqual(unfiltered.result.points.map((point) => point.id), ids, 'cosine ranking');

    const filtered = await qdrant('POST', `${smokePoints}/query`, {
      ...query,
      filter: tenantFilter,
      with_payload: true,
    });
    assert.deepEqual(filtered.result.points.map((point) => point.id), ids.slice(1), 'payload filter');
    assert.equal(filtered.result.points[0].payload.tenant, 'public');

    await deletePoints(qdrant, [ids[1]]);
    assert.deepEqual(await readPointIds(qdrant, ids.slice(1)), [ids[2]], 'deleted point is absent');
    const afterDelete = await qdrant('POST', `${smokePoints}/query`, { ...query, filter: tenantFilter });
    assert.deepEqual(afterDelete.result.points.map((point) => point.id), [ids[2]], 'search after deletion');
  } finally {
    await deletePoints(qdrant, ids);
  }
}

async function insertSupportFixture(client, id) {
  await client.query(
    `INSERT INTO "user" (id, email, name, updated_at)
     VALUES ($1, $2, 'Synthetic integration user', now()) ON CONFLICT (id) DO NOTHING`,
    [id, `${id}@example.invalid`],
  );
  await client.query(
    `INSERT INTO "Chat" (id, "userId", "updatedAt") VALUES ($1, $2, now()) ON CONFLICT (id) DO NOTHING`,
    [`${id}-chat`, id],
  );
  await client.query(
    `INSERT INTO "SupportCase" (id, "chatId", "userId", reason, issue, "updatedAt")
     VALUES ($1, $2, $3, 'CUSTOMER_REQUEST', $4, now()) ON CONFLICT (id) DO NOTHING`,
    [`${id}-case`, `${id}-chat`, id, supportIssue],
  );
}

async function assertSupportFixture(client, id) {
  const result = await client.query(
    `SELECT u.email, c.issue
     FROM "SupportCase" c
     JOIN "Chat" h ON h.id = c."chatId" AND h."userId" = c."userId"
     JOIN "user" u ON u.id = c."userId"
     WHERE u.id = $1 AND h.id = $2 AND c.id = $3`,
    [id, `${id}-chat`, `${id}-case`],
  );
  assert.deepEqual(result.rows, [{ email: `${id}@example.invalid`, issue: supportIssue }]);
}

export async function seedFixtures(pool, qdrant) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertSupportFixture(client, seedId);
    await assertSupportFixture(client, seedId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await upsertPoints(qdrant, vectors(seedId, seedPointIds));
}

async function withRollback(pool, check) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await check(client);
    } finally {
      await client.query('ROLLBACK');
    }
  } finally {
    client.release();
  }
}

async function expectConstraint(client, query, params, error) {
  await client.query('SAVEPOINT constraint_check');
  try {
    await assert.rejects(client.query(query, params), error);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT constraint_check');
    await client.query('RELEASE SAVEPOINT constraint_check');
  }
}

export async function checkFixtures(pool, qdrant) {
  const vector = await pool.query("SELECT '[1,0]'::vector <=> '[0,1]'::vector AS distance");
  assert.deepEqual(vector.rows, [{ distance: 1 }], 'pgvector cosine distance');
  await assertSupportFixture(pool, seedId);
  assert.deepEqual((await readPointIds(qdrant, seedPointIds)).sort(), seedPointIds);

  const id = `support-integration-${randomUUID()}`;
  const assertUserIsAbsent = async () => {
    const result = await pool.query('SELECT id FROM "user" WHERE id = $1', [id]);
    assert.equal(result.rowCount, 0, 'probe user must be invisible outside the transaction');
  };
  await withRollback(pool, async (client) => {
    await insertSupportFixture(client, id);
    await assertSupportFixture(client, id);
    await assertUserIsAbsent();

    const updated = await client.query(
      'UPDATE "SupportCase" SET status = \'RESOLVED\' WHERE id = $1 RETURNING status',
      [`${id}-case`],
    );
    assert.deepEqual(updated.rows, [{ status: 'RESOLVED' }]);
    await expectConstraint(
      client,
      'INSERT INTO "Chat" (id, "userId", "updatedAt") VALUES ($1, $2, now())',
      [`${id}-duplicate-chat`, id],
      { code: '23505', constraint: 'Chat_userId_key' },
    );
    await expectConstraint(
      client,
      'INSERT INTO "Chat" (id, "userId", "updatedAt") VALUES ($1, $2, now())',
      [`${id}-orphan-chat`, `${id}-missing-user`],
      { code: '23503', constraint: 'Chat_userId_fkey' },
    );
    const removed = await client.query('DELETE FROM "SupportCase" WHERE id = $1', [`${id}-case`]);
    assert.equal(removed.rowCount, 1);
    const reread = await client.query('SELECT id FROM "SupportCase" WHERE id = $1', [`${id}-case`]);
    assert.equal(reread.rowCount, 0);
  });
  await assertUserIsAbsent();
  await checkVectors(qdrant);
}

export async function checkServiceContract(pool, qdrant) {
  await ensureSmokeCollection(qdrant);
  const relation = 'pg_temp.support_integration_probe';
  const checkAbsent = async (client) => {
    const result = await client.query('SELECT to_regclass($1)::text AS relation', [relation]);
    assert.equal(result.rows[0].relation, null);
  };
  await withRollback(pool, async (client) => {
    await client.query('CREATE TEMP TABLE support_integration_probe (id int PRIMARY KEY, label text NOT NULL)');
    await client.query('INSERT INTO pg_temp.support_integration_probe VALUES (1, \'probe\')');
    await checkAbsent(pool);
    await expectConstraint(
      client,
      'INSERT INTO pg_temp.support_integration_probe VALUES (1, \'duplicate\')',
      [],
      { code: '23505' },
    );
    const result = await client.query('SELECT label FROM pg_temp.support_integration_probe WHERE id = 1');
    assert.deepEqual(result.rows, [{ label: 'probe' }]);
  });
  await checkAbsent(pool);
  await checkVectors(qdrant);
}
