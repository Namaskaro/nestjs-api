const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { login, products } = require('./seed.cjs');
const { prompts } = require('./ai.cjs');
const { io } = createRequire(
  resolve(__dirname, '../../../../frontend/package.json'),
)('socket.io-client');

async function request(
  api,
  path,
  { method = 'GET', cookie, body, status = 200 } = {},
) {
  const response = await fetch(api + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  assert.equal(
    response.status,
    status,
    `${method} ${path}: ${await response.clone().text()}`,
  );
  return {
    body: status === 204 ? null : await response.json(),
    cookies: response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
  };
}

async function authenticate(api, email, role) {
  const session = await request(api, '/auth/login', {
    method: 'POST',
    body: { email, password: login.password },
  });
  assert.match(session.cookies, /accessToken=/);
  assert.match(session.cookies, /refreshToken=/);
  const me = await request(api, '/user/me', { cookie: session.cookies });
  assert.equal(me.body.role, role);
  assert.equal(me.body.email, email);
  return session.cookies;
}

async function socketConnect(api, cookie) {
  const socket = io(api, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    ...(cookie ? { extraHeaders: { cookie } } : {}),
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('WebSocket connection timeout')),
      8000,
    );
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  }).catch((error) => {
    socket.close();
    throw error;
  });
  return socket;
}

async function chatTurn(socket, chatId, content) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error(`Assistant timeout for ${content}`)),
      30000,
    );
    function finish(error, message) {
      clearTimeout(timer);
      socket.off('chat:new_message', onMessage);
      socket.off('chat:error', onError);
      if (error) reject(error);
      else resolve(message);
    }
    function onMessage(message) {
      if (message.role === 'ASSISTANT') finish(null, message);
    }
    function onError(error) {
      finish(new Error(JSON.stringify(error)));
    }
    socket.on('chat:new_message', onMessage);
    socket.on('chat:error', onError);
    socket
      .timeout(8000)
      .emit('chat:send_message', { chatId, content }, (error, saved) => {
        if (error) finish(error);
        else if (!saved?.id)
          finish(new Error('Chat did not persist user message'));
      });
  });
}

async function run({ api, shop }) {
  for (const path of [
    '/catalog',
    '/login',
    `/product/${products[0].id}`,
    '/admin/reviews',
  ]) {
    const page = await fetch(shop + path, {
      signal: AbortSignal.timeout(45000),
    });
    assert.equal(page.status, 200, `Next page ${path}`);
    await page.arrayBuffer();
    console.log(`PASS Next ${path}`);
  }
  const buyer = await authenticate(api, login.buyer, 'Client');
  const manager = await authenticate(api, login.manager, 'Manager');
  await request(api, '/user/me', { status: 401 });
  await request(api, '/reviews/moderation', { cookie: buyer, status: 403 });
  const productId = products[0].id;
  const ownerPath = `/reviews/${productId}/mine`;
  assert.equal(
    (await request(api, ownerPath, { cookie: buyer })).body.canCreate,
    true,
  );
  const originalStats = (await request(api, `/reviews/${productId}/stats`))
    .body;
  const first = (await request(api, `/reviews/${productId}?take=2&sort=rating`))
    .body;
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const second = (
    await request(
      api,
      `/reviews/${productId}?take=2&sort=rating&cursor=${encodeURIComponent(
        first.nextCursor,
      )}`,
    )
  ).body;
  assert.equal(second.items.length, 2);
  assert.ok(
    second.items.every(({ id }) => !first.items.some((row) => row.id === id)),
  );
  const vote = first.items[0];
  await request(api, `/reviews/${vote.id}/vote`, {
    method: 'PUT',
    cookie: buyer,
    body: { publicationId: vote.publicationId, value: 'UP' },
  });
  try {
    assert.equal(
      (
        await request(api, `/reviews/${productId}/my-votes?ids=${vote.id}`, {
          cookie: buyer,
        })
      ).body[0].value,
      'UP',
    );
  } finally {
    await request(api, `/reviews/${vote.id}/vote`, {
      method: 'PUT',
      cookie: buyer,
      body: { publicationId: vote.publicationId, value: null },
    });
  }
  console.log('PASS real login, roles, pagination, statistics and voting');
  const draft = (
    await request(api, '/reviews/create', {
      method: 'POST',
      cookie: buyer,
      status: 201,
      body: { productId, rating: 5, text: 'Технический smoke Review Live.' },
    })
  ).body;
  try {
    assert.equal(draft.status, 'PENDING');
    assert.equal(
      (await request(api, `/reviews/${productId}/stats`)).body.ratingCount,
      originalStats.ratingCount,
    );
    const moderation = `/reviews/moderation/reviews/${draft.id}`;
    const body = { publicationId: draft.publicationId, decision: 'PUBLISHED' };
    await request(api, moderation, {
      method: 'PATCH',
      cookie: buyer,
      body,
      status: 403,
    });
    await request(api, moderation, { method: 'PATCH', cookie: manager, body });
    assert.equal(
      (await request(api, `/reviews/${productId}/stats`)).body.ratingCount,
      originalStats.ratingCount + 1,
    );
    console.log(
      'PASS delivered purchase, pending visibility and staff approval',
    );
  } finally {
    await request(
      api,
      `/reviews/${draft.id}?publicationId=${draft.publicationId}`,
      {
        method: 'DELETE',
        cookie: buyer,
        status: 204,
      },
    );
  }
  assert.equal(
    (await request(api, ownerPath, { cookie: buyer })).body.canCreate,
    true,
  );
  await request(api, '/auth/login/access-token', {
    method: 'POST',
    cookie: buyer,
  });
  const socket = await socketConnect(api, buyer);
  try {
    const chat = await socket.timeout(8000).emitWithAck('chat:start');
    assert.ok(chat?.id, 'Authenticated chat:start returned no chat');
    const search = await chatTurn(socket, chat.id, prompts.search);
    console.log('Search response:', search.content);
    assert.match(JSON.stringify(search), /Кроссовки Альфа/);
    const details = await chatTurn(socket, chat.id, prompts.details);
    console.log('Review Q&A response:', details.content);
    assert.match(JSON.stringify(details), /reviewAnswer/);
    assert.match(details.content, /положительный опыт прогулок/);
    assert.doesNotMatch(details.content, /[«»]/);
    assert.match(JSON.stringify(details), /reviewExperience/);
    assert.match(JSON.stringify(details), /positiveImpressions/);
    const compare = await chatTurn(socket, chat.id, prompts.compare);
    assert.match(JSON.stringify(compare), /comparisonPresentation/);
    assert.match(JSON.stringify(compare), /averageRating/);
    const recommend = await chatTurn(socket, chat.id, prompts.recommend);
    assert.match(recommend.content, /Для прогулок рекомендую/);
    assert.match(JSON.stringify(recommend), /reviewEvidence/);
    assert.doesNotMatch(recommend.content, /\d+\.\d{3,}/);
    console.log(
      'PASS real WebSocket search, Summary, Review Q&A, Compare and Recommendation',
    );
  } finally {
    socket.close();
  }
}

module.exports = { run };
