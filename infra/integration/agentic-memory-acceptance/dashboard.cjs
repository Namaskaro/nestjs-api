
const scenarios = require('./scenarios.cjs');
const wirePanel = require('./dashboard-client.cjs');
const escape = input => String(input).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const button = (label, action) => '<button type="button" data-context-action="' + action + '">' + label + '</button>';

function renderScenario({ key, account, day, title, steps, pass }, accountEmail, front) {
  const prepare = key === 'decline' ? 'Подготовить DECLINE' : 'Подготовить сценарий';
  const instruction = 'Закройте чат в открытых вкладках магазина и нажмите «' + prepare + '».';
  return '<article class="scenario" id="scenario-' + key + '"><h3>' + title + '</h3>' +
    '<p class="setup"><strong>Аккаунт</strong> ' + (account ? '<code>' + escape(accountEmail) + '</code>' : 'без входа') +
    ' <span>Начальный день <strong>' + day + '</strong></span></p>' +
    '<div class="actions"><button type="button" class="primary" data-prepare="' + key + '">' + prepare + '</button>' +
    '<a class="button" href="' + front + (key === 'guest' ? '/' : '/auth?activeTab=login') + '" target="_blank" rel="noopener">Открыть магазин</a>' +
    '<button type="button" data-reset="' + key + '">Сбросить сценарий</button>' +
    (key === 'reconnect' ? '<button type="button" id="reconnect">Переподключить чат</button>' : '') + '</div>' +
    (account ? '<p class="note">Сброс очищает чат этого тестового аккаунта. Чтобы начать заново, нажмите «' + prepare + '».</p>' :
      '<p class="note">У гостя нет сохранённого чата. Для повтора откройте магазин в новом приватном окне.</p>') +
    '<output class="status" data-prepare-status="' + key + '" aria-live="polite"></output>' +
    '<ol><li>' + instruction + '</li>' + steps.map(step => '<li>' + escape(step) + '</li>').join('') + '</ol>' +
    '<p class="verdict"><strong>PASS</strong> ' + escape(pass) + '<br><strong>FAIL</strong> Результат отличается от описанного.</p></article>';
}

module.exports = ({ front, now, day, token, accounts, password, contextAccounts }) => {
  const email = new Map(accounts.map(account => [account.name, account.email]));
  const context = '<section id="user-context"><h2>User Context</h2>' +
    '<p>Выберите тестовый аккаунт и сравните условия подбора с подтверждёнными предпочтениями.</p>' +
    '<div class="actions"><label for="context-account">Тестовый аккаунт</label><select id="context-account">' +
    contextAccounts.map(account => '<option value="' + escape(account.name) + '">' + escape(account.email) + '</option>').join('') +
    '</select></div>' +
    '<div class="context-grid"><article><h3>Agentic Memory</h3><p class="note">Условия предыдущего подбора</p>' +
    '<p><strong id="episode-status">Загрузка эпизода…</strong></p><p id="episode-restore" hidden></p><p id="episode-history" hidden></p>' +
    '<p id="episode-summary" hidden></p><ul id="episode-criteria"></ul></article>' +
    '<article><h3>User Context</h3><p class="note">Подтверждённые предпочтения покупателя</p>' +
    '<p id="profile-status">Загрузка профиля…</p><ul id="profile-facts"></ul></article></div>' +
    '<p id="context-status" class="status" role="status"></p>' +
    '<div id="context-expiry" class="test" hidden><h3>Сравнение дней 89 и 90</h3>' +
    '<p id="context-day89"></p><p>Выше показано состояние на день 90. День магазина не менялся.</p>' +
    '<button type="button" id="context-exit-expiry">Вернуться к дню 0</button></div>' +
    '<article class="test"><h3>Сохранение цвета</h3><ol>' +
    '<li>Нажмите «Подготовить тестовый эпизод». Синий цвет появится в условиях подбора.</li>' +
    '<li>Нажмите «Подтвердить синий цвет», затем «Проверить профиль». В профиле останется «Цвет — синий · подтверждено».</li>' +
    '<li>Нажмите «Удалить предпочтение». Профиль станет пустым, условия подбора сохранятся.</li></ol>' +
    '<div class="actions">' + button('Подготовить тестовый эпизод', 'prepare') + button('Подтвердить синий цвет', 'confirm') +
    button('Проверить профиль', 'read') + button('Удалить предпочтение', 'delete-fact') + '</div></article>' +
    '<article class="test"><h3>Истечение и изменение источника</h3>' +
    '<p>Сначала подготовьте эпизод и подтвердите синий цвет. «Проверить истечение эпизода» сравнит дни 89 и 90. На день 90 агент теряет доступ к эпизоду, а цвет остаётся в профиле.</p>' +
    '<p>«Проверить отзыв при изменении источника» изменит цвет эпизода на зелёный. Профиль должен стать пустым.</p>' +
    '<div class="actions">' + button('Проверить истечение эпизода', 'expire') +
    button('Проверить отзыв при изменении источника', 'correct-color') + '</div>' +
    '<details><summary>Проверить отзыв при удалении эпизода</summary>' +
    '<p>Сбросьте тест, подготовьте эпизод и подтвердите синий цвет. Нажмите «Удалить исходный эпизод». Эпизод и предпочтение должны исчезнуть.</p>' +
    button('Удалить исходный эпизод', 'delete-episode') + '</details></article>' +
    '<div class="actions">' + button('Сбросить тест User Context', 'reset') +
    '<span class="note">Очищает эпизод и профиль выбранного тестового аккаунта.</span></div>' +
    '<details><summary>Технические данные</summary><pre id="context-details"></pre></details></section>';
  const css = 'html{scroll-behavior:smooth}body{margin:0;color:#19293a;background:#f4f7fa;font:16px/1.55 system-ui,sans-serif}' +
    'main{max-width:1360px;margin:auto;padding:24px 20px 72px}h1,h2,h3{line-height:1.2}h1{margin:0 0 .7rem}h2{margin-top:0}' +
    'a{color:#07589d}a:focus-visible,button:focus-visible,select:focus-visible{outline:3px solid #2974aa;outline-offset:3px}' +
    'button,select,.button{font:inherit;border:1px solid #aabaca;border-radius:8px;background:#fff;color:inherit;padding:.42rem .68rem}.button{text-decoration:none}' +
    'button{cursor:pointer}button:hover:not(:disabled),button[aria-pressed="true"]{background:#e1effc;border-color:#4482b2}' +
    'button:disabled{opacity:.55;cursor:default}code{font-size:.95em;overflow-wrap:anywhere}' +
    '.actions,.links,.setup{display:flex;gap:.55rem 1rem;align-items:center;flex-wrap:wrap}.links{margin:1rem 0}' +
    '.workspace{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:1.35rem;margin-top:1.35rem}' +
    '.scenario,.test,.context-grid article,.clock{background:#fff;border:1px solid #d7e2eb;border-radius:12px;padding:1rem}' +
    '.scenario,.test{margin:0 0 1rem}.scenario h3,.context-grid h3,.test h3{margin-top:0}.note{color:#40566b;font-size:.9rem}' +
    '.section-links a{font-weight:650}.primary{background:#edf5fb;border-color:#79a7c9}section,article{scroll-margin-top:1rem}' +
    '.verdict{background:#edf5fb;padding:.6rem .8rem;border-radius:8px}.verdict strong{font-size:.85rem;letter-spacing:.05em}' +
    '.status{display:block}.status:empty,[hidden]{display:none}.status:not(:empty){margin-top:.5rem}.status[data-state="pass"]{color:#11613b}.status[data-state="fail"]{color:#9b2938}' +
    '.context-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;margin-top:.75rem}.context-grid ul{margin:0;padding-left:1.25rem}' +
    'details{margin-top:.75rem}summary{cursor:pointer}li{margin:.35rem 0}pre{overflow:auto;max-height:25rem;background:#fff;padding:.7rem}' +
    '@media(max-width:850px){.workspace{grid-template-columns:1fr}main{padding:24px 14px 48px}}' +
    '@media(max-width:480px){.context-grid{grid-template-columns:1fr}}';
  const controls = [0, 7, 13, 14, 89, 90].map(value => '<button type="button" data-day="' + value + '" aria-pressed="' +
    String(day === value) + '">' + (value === 0 ? 'Установить день 0' : 'День ' + value) + '</button>').join('');
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Приёмка Agentic Memory и User Context</title><style>' + css + '</style></head><body><main><header><h1>Панель ручной приёмки</h1>' +
    '<div class="actions"><a href="' + front + '/auth?activeTab=login" target="_blank" rel="noopener">Войти в тестовый магазин</a>' +
    '<span>Пароль тестовых аккаунтов <code id="test-password">' + escape(password) + '</code></span>' +
    '<button type="button" id="copy-password">Копировать пароль</button><output id="copy-result" aria-live="polite"></output></div>' +
    '<nav class="links section-links" aria-label="Разделы приёмки"><a href="#memory-scenarios">Agentic Memory</a><a href="#user-context">User Context</a></nav></header>' +
    '<section class="clock"><h2>Тестовое время</h2><p>Текущий день <strong id="day">' + day + '</strong> · <time id="simulated-time">' +
    now.toISOString().slice(0, 10) + '</time>. После смены дня обновите вкладку магазина и снова откройте чат.</p>' +
    '<div class="actions">' + controls + '</div><output class="status" id="scenario-status" aria-live="polite"></output></section>' +
    '<div class="workspace"><section id="memory-scenarios"><h2>Agentic Memory</h2><nav class="links" aria-label="Сценарии Agentic Memory">' + scenarios.map(({ key }) =>
      '<a href="#scenario-' + key + '">' + key.toUpperCase() + '</a>').join('') + '</nav>' +
    scenarios.map(scenario => renderScenario(scenario, email.get(scenario.account), front)).join('') + '</section>' + context +
    '</div></main><script>(' + wirePanel.toString() + ')(' + JSON.stringify({ 'X-Acceptance-Token': token }) + ');</script></body></html>';
};
