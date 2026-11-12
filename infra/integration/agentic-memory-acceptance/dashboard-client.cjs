
module.exports = function wirePanel(headers) {
  const byId = id => document.getElementById(id);
  const generalStatus = byId('scenario-status');
  const contextStatus = byId('context-status');
  const contextAccount = byId('context-account');
  const contextActions = [...document.querySelectorAll('[data-context-action]')];
  const dayButtons = [...document.querySelectorAll('[data-day]')];
  const preparationButtons = [...document.querySelectorAll('[data-prepare]')];
  const resetButtons = [...document.querySelectorAll('[data-reset]')];
  const criteriaNames = { category: 'Категория', subcategory: 'Подкатегория', brand: 'Бренд', color: 'Цвет', price: 'Бюджет', sizes: 'Размер' };
  let contextReady = false;
  let episodeReady = false;
  let factReady = false;
  let linkedFactReady = false;
  let viewingExpiry = false;
  let contextBusy = false;
  let scenarioBusy = false;

  async function post(path) {
    const response = await fetch('/__acceptance/' + path, { method: 'POST', headers, credentials: 'same-origin' });
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
    if (!response.ok) throw new Error(data.message ?? 'Стенд вернул HTTP ' + response.status + '.');
    return data;
  }

  function report(element, text, state = '') {
    element.textContent = text;
    element.dataset.state = state;
  }

  function showTime({ day, now }) {
    byId('day').textContent = day;
    byId('simulated-time').textContent = now.slice(0, 10);
    for (const button of dayButtons) button.setAttribute('aria-pressed', String(Number(button.dataset.day) === day));
  }

  async function setScenario(path, text, affectsTime = true, key) {
    if (scenarioBusy) return;
    scenarioBusy = true;
    const buttons = [...dayButtons, ...preparationButtons, ...resetButtons, byId('reconnect')];
    for (const button of buttons) button.disabled = true;
    const local = key ? document.querySelector('[data-prepare-status="' + key + '"]') : null;
    const updateStatus = (text, state) => {
      report(generalStatus, text, state);
      if (local) report(local, text, state);
    };
    updateStatus('Выполняется…');
    try {
      const data = await post(path);
      if (affectsTime) showTime(data);
      updateStatus(text(data), 'pass');
    } catch (error) {
      updateStatus('Не выполнено. ' + error.message, 'fail');
    } finally {
      scenarioBusy = false;
      for (const button of buttons) button.disabled = false;
    }
  }

  for (const button of dayButtons) {
    button.onclick = () => setScenario('time/' + button.dataset.day, data => 'Установлен день ' + data.day + '.');
  }
  for (const button of preparationButtons) {
    button.onclick = () => {
      const key = button.dataset.prepare;
      setScenario('prepare/' + key, data => key.toUpperCase() + ' готов · день ' + data.day + '. Продолжайте со второго шага.', true, key);
    };
  }
  for (const button of resetButtons) {
    button.onclick = () => {
      const key = button.dataset.reset;
      setScenario('reset-scenario/' + key, data => data.hasAccount ?
        'Сценарий сброшен. Чат очищен. Нажмите «' +
          (key === 'decline' ? 'Подготовить DECLINE' : 'Подготовить сценарий') + '», чтобы повторить проверку.' :
        'У гостя нет сохранённого чата. Для повтора откройте магазин в новом приватном окне.', false, key);
    };
  }
  byId('reconnect').onclick = () => setScenario('reconnect/reconnect',
    data => 'Переподключение запущено. Соединений: ' + data.disconnected + '.', false, 'reconnect');
  byId('copy-password').onclick = async () => {
    const result = byId('copy-result');
    try {
      await navigator.clipboard.writeText(byId('test-password').textContent);
      report(result, 'Пароль скопирован.', 'pass');
    } catch {
      const password = byId('test-password');
      const range = document.createRange();
      range.selectNodeContents(password);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      if (document.execCommand('copy')) {
        window.getSelection().removeAllRanges();
        report(result, 'Пароль скопирован.', 'pass');
      } else {
        report(result, 'Пароль выделен. Нажмите Ctrl+C.', 'fail');
      }
    }
  };

  function showList(element, lines) {
    element.replaceChildren(...lines.map(text => {
      const entry = document.createElement('li');
      entry.textContent = text;
      return entry;
    }));
  }

  function updateContextActions() {
    for (const button of contextActions) {
      const action = button.dataset.contextAction;
      const requiresSource = ['expire', 'delete-episode', 'correct-color'].includes(action);
      button.disabled = contextBusy || (viewingExpiry && action !== 'reset') ||
        (action === 'confirm' && !episodeReady) ||
        (action === 'delete-fact' && !factReady) || (requiresSource && !linkedFactReady);
    }
    byId('context-exit-expiry').disabled = contextBusy;
    contextAccount.disabled = contextBusy;
  }

  function showContext(result) {
    contextReady = true;
    const constraints = result.episode?.snapshot.constraints ?? [];
    const color = constraints.find(item => item.attributeId === 'color' && item.operator === 'eq')?.value;
    const brand = constraints.find(item => item.attributeId === 'brand' && item.operator === 'eq')?.value;
    const budget = constraints.find(item => item.attributeId === 'price' && item.operator === 'lte')?.value;
    const facts = result.profile.facts;
    const fact = facts.find(item => item.domainKey === 'SHOES' && item.preferenceKey === 'color');
    const expiry = result.expiry;
    viewingExpiry = Boolean(expiry);
    episodeReady = color === 'синий';
    factReady = Boolean(fact);
    linkedFactReady = Boolean(result.episode && fact?.source.episodeId === result.episode.id);
    byId('episode-status').textContent = result.episode ? 'Эпизод активен' :
      viewingExpiry ? 'Эпизод истёк' : 'Эпизод отсутствует.';
    const restore = byId('episode-restore');
    restore.hidden = !expiry;
    restore.textContent = expiry ? 'Доступен агенту для восстановления: ' + (expiry.day90.restoreAvailable ? 'да' : 'нет') + '.' : '';
    const history = byId('episode-history');
    history.hidden = !expiry;
    history.textContent = expiry ? (expiry.day90.historySaved ?
      'Историческая запись сохранена до плановой очистки.' : 'Историческая запись уже очищена.') : '';
    const colorPlural = { синий: 'синие', зелёный: 'зелёные' }[color];
    const summary = byId('episode-summary');
    summary.hidden = !(colorPlural && brand && typeof budget === 'number');
    summary.textContent = summary.hidden ? '' : 'Покупатель искал ' + colorPlural + ' кроссовки ' + brand +
      ' стоимостью до ' + budget.toLocaleString('ru-RU') + ' ₽.';
    showList(byId('episode-criteria'), constraints.map(({ attributeId, operator, value, unit }) => {
      const prefix = operator === 'lte' ? 'до ' : operator === 'gte' ? 'от ' : '';
      const display = attributeId === 'price' && typeof value === 'number' ? value.toLocaleString('ru-RU') + ' ₽' : String(value) + (unit ? ' ' + unit : '');
      return (criteriaNames[attributeId] ?? attributeId) + ' — ' + prefix + display;
    }));
    byId('profile-status').textContent = viewingExpiry ?
      'Подтверждённое предпочтение: ' + (fact?.value ?? 'отсутствует') + '.' :
      facts.length ? 'Предпочтения сохранены.' : 'В профиле нет предпочтений.';
    showList(byId('profile-facts'), facts.map(fact =>
      (criteriaNames[fact.preferenceKey] ?? fact.preferenceKey) + ' — ' + fact.value + ' · подтверждено'));
    byId('context-expiry').hidden = !expiry;
    byId('context-day89').textContent = expiry ?
      'День 89. ' + (expiry.day89.episodeVisible ? 'Эпизод активен.' : 'Эпизод недоступен.') +
      ' Доступен агенту для восстановления: ' + (expiry.day89.restoreAvailable ? 'да' : 'нет') +
      '. Подтверждённое предпочтение: ' + (expiry.day89.color ?? 'отсутствует') + '.' : '';
    byId('context-details').textContent = JSON.stringify({ episode: result.episode, profile: result.profile, expiry }, null, 2);
    report(contextStatus, (result.pass === null ? '' : result.pass ? 'PASS · ' : 'FAIL · ') + result.message,
      result.pass === null ? '' : result.pass ? 'pass' : 'fail');
  }

  function clearContext() {
    contextReady = episodeReady = factReady = linkedFactReady = false;
    viewingExpiry = false;
    byId('episode-status').textContent = 'Загрузка эпизода…';
    byId('profile-status').textContent = 'Загрузка профиля…';
    byId('episode-criteria').replaceChildren();
    byId('episode-summary').hidden = true;
    byId('episode-restore').hidden = true;
    byId('episode-history').hidden = true;
    byId('profile-facts').replaceChildren();
    byId('context-details').textContent = '';
    byId('context-expiry').hidden = true;
  }

  async function runContext(action) {
    if (contextBusy) return;
    contextBusy = true;
    updateContextActions();
    report(contextStatus, 'Выполняется…');
    try {
      showContext(await post('user-context/' + contextAccount.value + '/' + action));
      if (action === 'expire') byId('episode-status').scrollIntoView({ block: 'center' });
    } catch (error) {
      if (!contextReady) {
        byId('episode-status').textContent = 'Не удалось загрузить эпизод.';
        byId('profile-status').textContent = 'Не удалось загрузить профиль.';
      }
      report(contextStatus, 'Не выполнено. ' + error.message, 'fail');
    } finally {
      contextBusy = false;
      updateContextActions();
    }
  }

  for (const button of contextActions) button.onclick = () => runContext(button.dataset.contextAction);
  byId('context-exit-expiry').onclick = () => runContext('read');
  contextAccount.onchange = () => { clearContext(); runContext('read'); };
  updateContextActions();
  runContext('read');
  window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
};
