
const { randomUUID } = require('node:crypto');

const accounts = ['context', 'context-alt', 'context-expiry'];
const operations = ['read', 'prepare', 'confirm', 'delete-fact', 'expire', 'delete-episode', 'correct-color', 'reset'];
const profilePath = '/me/user-context';
const preferencePath = profilePath + '/preferences/SHOES/color';
const criterion = { attributeId: 'color', operator: 'eq' };
const dayMs = 86_400_000;

const colorFact = profile => profile.facts.find(item => item.domainKey === 'SHOES' && item.preferenceKey === 'color');

function reject(status, message) {
  throw Object.assign(new Error(message), { status });
}

async function call(base, path, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(base + path, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const status = response.status;
    reject(status, status === 409 ? 'Данные изменились. Нажмите «Проверить профиль» и повторите действие.' :
      'Операция не выполнена. API вернул HTTP ' + status + '.');
  }
  return response;
}

function install({ express, back, authorize, fixture, identityOf, prepare, reset, inspectExpiry, anchor, internalClockKey }) {
  const busy = new Set();
  express.post('/__acceptance/user-context/:name/:operation', async (req, res) => {
    if (!authorize(req)) return res.sendStatus(403);
    const { name, operation } = req.params;
    if (!accounts.includes(name) || !operations.includes(operation)) return res.sendStatus(404);
    if (busy.has(name)) return res.status(409).json({ message: 'Операция для этого аккаунта уже выполняется.' });
    busy.add(name);
    try {
      if (operation === 'reset') await reset(name);
      const identity = identityOf(name);
      if (!identity) reject(404, 'Тестовый аккаунт отсутствует.');
      const login = await call(back, '/auth/login', {
        method: 'POST', body: { email: fixture.address(name), password: fixture.password },
      });
      const { user } = await login.json();
      if (user?.id !== identity.userId || user.role !== 'Client') reject(403, 'Аккаунт не принадлежит этому сценарию.');
      const cookie = login.headers.getSetCookie().map(value => value.split(';')[0])
        .find(value => value.startsWith('accessToken='));
      if (!cookie) reject(401, 'Не удалось получить тестовую сессию.');

      const episodesPath = '/chat/' + encodeURIComponent(identity.chatId) + '/consultation-episodes';
      const request = (path, method, body, at = anchor) => call(back, path, {
        method, body, headers: { Cookie: cookie, 'X-Acceptance-Clock-Key': internalClockKey, 'X-Acceptance-Clock-At': String(at) },
      });
      const read = async (at = anchor) => {
        const [episodes, profile] = await Promise.all([
          request(episodesPath, 'GET', undefined, at).then(response => response.json()),
          request(profilePath, 'GET', undefined, at).then(response => response.json()),
        ]);
        return {
          episode: episodes.find(item => item.taskKey === 'browser-acceptance-' + name) ?? null,
          profile,
        };
      };

      const initial = await read();
      const { episode, profile } = initial;
      const color = episode?.snapshot.constraints.find(item => item.attributeId === 'color' && item.operator === 'eq');
      const fact = colorFact(profile);
      const episodePath = episode && episodesPath + '/' + encodeURIComponent(episode.id);
      let view;
      let expiry = null;
      let expected = null;
      let message = 'Профиль обновлён через API.';
      switch (operation) {
        case 'prepare':
          if (episode && color?.value !== 'синий') {
            reject(409, 'Цвет эпизода уже изменён. Нажмите «Сбросить тест User Context», затем подготовьте эпизод заново.');
          }
          if (!episode) await prepare(name);
          message = 'Тестовый эпизод готов.';
          expected = state => state.episode?.snapshot.constraints.some(item =>
            item.attributeId === 'color' && item.operator === 'eq' && item.value === 'синий');
          break;
        case 'confirm':
          if (color?.value !== 'синий') reject(409, 'Сначала нажмите «Подготовить тестовый эпизод».');
          await request(preferencePath, 'PUT', {
            commandId: randomUUID(), expectedRevision: profile.revision,
            evidence: { chatId: identity.chatId, episodeId: episode.id, episodeRevision: episode.revision, criterion },
          });
          message = 'Цвет подтверждён.';
          expected = state => state.profile.facts.some(item => item.value === color.value && item.source.episodeId === episode.id);
          break;
        case 'delete-fact':
          if (!fact) reject(409, 'В профиле уже нет предпочтения.');
          await request(preferencePath + '?expectedRevision=' + profile.revision, 'DELETE');
          message = 'Предпочтение удалено из профиля.';
          expected = state => Boolean(state.episode && !state.profile.facts.length);
          break;
        case 'expire': {
          if (!episode || fact?.source.episodeId !== episode.id) reject(409, 'Подготовьте эпизод и подтвердите его цвет.');
          const expiresAt = Date.parse(episode.expiresAt);
          const before = await read(expiresAt - dayMs);
          const day89 = await inspectExpiry(identity, episode.id, expiresAt - dayMs);
          view = await read(expiresAt);
          const day90 = await inspectExpiry(identity, episode.id, expiresAt);
          const beforeFact = colorFact(before.profile);
          const afterFact = colorFact(view.profile);
          expiry = {
            day89: { episodeVisible: before.episode?.id === episode.id, color: beforeFact?.value ?? null, ...day89 },
            day90,
          };
          message = 'Проверены ответы API на дни 89 и 90.';
          expected = () => expiry.day89.episodeVisible && day89.restoreAvailable &&
            !view.episode && !day90.restoreAvailable &&
            [beforeFact, afterFact].every(item => item?.source.episodeId === episode.id && item.value === fact.value);
          break;
        }
        case 'delete-episode':
        case 'correct-color':
          if (!episode || fact?.source.episodeId !== episode.id) reject(409, 'Подготовьте эпизод и подтвердите его цвет.');
          if (operation === 'delete-episode') {
            await request(episodePath, 'DELETE');
            message = 'Исходный эпизод удалён.';
            expected = state => !state.episode && !state.profile.facts.length;
          } else {
            const nextColor = color?.value === 'зелёный' ? 'синий' : 'зелёный';
            await request(episodePath, 'PATCH', {
              revision: episode.revision, change: { criteria: { set: [{ ...criterion, value: nextColor, unit: null }] } },
            });
            message = 'Цвет исходного эпизода изменён на «' + nextColor + '».';
            expected = state => state.episode?.snapshot.constraints.some(item => item.attributeId === 'color' && item.value === nextColor) &&
              !state.profile.facts.length;
          }
          break;
        case 'reset':
          message = 'Данные выбранного тестового аккаунта сброшены.';
          expected = state => !state.episode && !state.profile.facts.length;
          break;
      }
      const state = view ?? (operation === 'read' || operation === 'reset' ? initial : await read());
      const pass = expected ? Boolean(expected(state)) : null;
      res.json({ ...state, expiry, message, pass });
    } catch (error) {
      res.status(error.status || 500).json({ message: error.status ? error.message : 'Стенд не смог выполнить операцию.' });
      if (!error.status) console.error('Acceptance User Context failed:', error.name, error.cause?.code);
    } finally {
      busy.delete(name);
    }
  });
}

module.exports = { accounts, install };
