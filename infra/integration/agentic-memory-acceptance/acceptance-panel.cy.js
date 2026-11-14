
const panel = 'http://127.0.0.1:41820';
const shop = 'http://127.0.0.1:41821';
const userContext = () => cy.get('#user-context');
const contextButton = label => userContext().contains('button', label);
const pass = text => cy.get('#context-status').should('contain.text', 'PASS').and('contain.text', text);
const reset = () => {
  contextButton('Сбросить тест User Context').click();
  pass('сброшены');
  cy.get('#episode-status').should('have.text', 'Эпизод отсутствует.');
  cy.get('#profile-status').should('have.text', 'В профиле нет предпочтений.');
};
const prepareAndConfirm = () => {
  contextButton('Подготовить тестовый эпизод').click();
  pass('эпизод готов');
  cy.get('#episode-criteria').should('contain.text', 'Цвет — синий');
  contextButton('Подтвердить синий цвет').click();
  pass('Цвет подтверждён');
  cy.get('#profile-facts').should('contain.text', 'Цвет — синий · подтверждено');
};
const prepareScenario = (key, day) => {
  cy.visit(panel + '/__acceptance');
  cy.get('#scenario-' + key).contains('button', key === 'decline' ? 'Подготовить DECLINE' : 'Подготовить сценарий').click();
  cy.get('[data-prepare-status=' + key + ']').should('contain.text', key.toUpperCase() + ' готов · день ' + day);
  cy.get('#day').should('have.text', String(day));
};

describe('Acceptance panel with real APIs', () => {
  beforeEach(() => {
    cy.visit(panel + '/__acceptance');
    cy.contains('a', /^User Context$/).click();
    cy.get('#context-status').should('contain.text', 'Профиль обновлён через API.');
  });

  it('prepares a real episode, confirms color, reads it again and removes the preference', () => {
    cy.get('#context-account').select('context');
    reset();
    prepareAndConfirm();
    contextButton('Проверить профиль').click();
    cy.get('#context-status').should('have.text', 'Профиль обновлён через API.');
    cy.get('#profile-facts').should('contain.text', 'Цвет — синий · подтверждено');
    cy.get('#context-account').select('context-alt');
    cy.get('#context-status').should('have.text', 'Профиль обновлён через API.');
    cy.get('#profile-facts').should('be.empty');
    cy.get('#context-account').select('context');
    cy.get('#profile-facts').should('contain.text', 'Цвет — синий · подтверждено');
    contextButton('Удалить предпочтение').click();
    pass('Предпочтение удалено');
    cy.get('#profile-facts').should('be.empty');
    cy.get('#episode-criteria').should('contain.text', 'Цвет — синий');
    reset();
  });

  it('retains the fact after logical expiry without changing the shop clock', () => {
    reset();
    prepareAndConfirm();
    cy.get('#day').invoke('text').then(day => {
      contextButton('Проверить истечение эпизода').click();
      pass('Проверены ответы API на дни 89 и 90.');
      cy.get('#context-day89').should('contain.text', 'День 89. Эпизод активен. Доступен агенту для восстановления: да.');
      cy.get('#episode-status').should('have.text', 'Эпизод истёк');
      cy.get('#episode-restore').should('have.text', 'Доступен агенту для восстановления: нет.');
      cy.get('#episode-summary').should('not.be.visible');
      cy.get('#profile-status').should('have.text', 'Подтверждённое предпочтение: синий.');
      cy.get('#day').should('have.text', day);
      cy.get('#context-exit-expiry').click();
      cy.get('#episode-status').should('have.text', 'Эпизод активен');
    });
    reset();
  });

  it('revokes the preference when the source episode is removed or its color is corrected', () => {
    reset();
    prepareAndConfirm();
    userContext().contains('summary', 'Проверить отзыв при удалении эпизода').click();
    contextButton('Удалить исходный эпизод').click();
    pass('Исходный эпизод удалён');
    cy.get('#episode-status').should('have.text', 'Эпизод отсутствует.');
    cy.get('#profile-facts').should('be.empty');
    reset();
    prepareAndConfirm();
    contextButton('Проверить отзыв при изменении источника').click();
    pass('зелёный');
    cy.get('#episode-criteria').should('contain.text', 'Цвет — зелёный');
    cy.get('#profile-facts').should('be.empty');
    reset();
  });

  it('copies the synthetic password and refuses requests outside the approved scope', () => {
    cy.window().then(win => {
      cy.stub(win.navigator.clipboard, 'writeText').resolves().as('clipboard');
    });
    cy.get('#copy-password').click();
    cy.get('#copy-result').should('contain.text', 'Пароль скопирован');
    cy.get('@clipboard').should('have.been.calledOnceWithExactly', 'Memory-V1-Local-482!');
    cy.request({ method: 'POST', url: panel + '/__acceptance/user-context/context/read', failOnStatusCode: false })
      .its('status').should('eq', 403);
    cy.document().then(doc => {
      const token = doc.documentElement.innerHTML.match(/X-Acceptance-Token":"([a-f0-9]{64})/)[1];
      cy.request({ method: 'POST', url: panel + '/__acceptance/user-context/decline/reset', failOnStatusCode: false,
        headers: { Origin: panel, 'X-Acceptance-Token': token } }).its('status').should('eq', 404);
    });
  });
});

describe('Instructions against the real storefront', () => {
  it('prepares DECLINE at day 7, dismisses the card, suppresses it at day 13 and resets for another run', () => {
    prepareScenario('decline', 7);
    cy.origin(shop, () => {
      cy.visit('/auth?activeTab=login');
      cy.get('[data-testid=email-input]').type('decline@memory-v1.example.test');
      cy.get('[data-testid=password-input]').type('Memory-V1-Local-482!', { log: false });
      cy.get('form[data-testid=login-form]').submit();
      cy.location('pathname').should('eq', '/');
      cy.contains('button', 'Чат поддержки').click();
      cy.get('[aria-label="Продолжение подбора"]').contains('Продолжим прошлый подбор?').should('be.visible');
      cy.get('[aria-label="Продолжение подбора"]').contains('button', 'Не сейчас').click();
      cy.get('[aria-label="Продолжение подбора"]').should('not.exist');
    });
    cy.visit(panel + '/__acceptance');
    cy.contains('button', /^День 13$/).click();
    cy.get('#day').should('have.text', '13');
    cy.origin(shop, () => {
      cy.visit('/');
      cy.contains('button', 'Чат поддержки').click();
      cy.get('textarea[aria-label=Message]').should('be.enabled');
      cy.contains('Подбор открыт.').should('be.visible');
      cy.get('[aria-label="Продолжение подбора"]').should('not.exist');
    });
    prepareScenario('decline', 7);
    cy.origin(shop, () => {
      cy.visit('/');
      cy.contains('button', 'Чат поддержки').click();
      cy.get('[aria-label="Продолжение подбора"]').contains('button', 'Не сейчас').should('be.enabled');
    });
  });

  it('follows PAUSED instructions at day 14 and shows the correct result', () => {
    prepareScenario('paused', 14);
    cy.origin(shop, () => {
      cy.visit('/auth?activeTab=login');
      cy.get('[data-testid=email-input]').type('paused@memory-v1.example.test');
      cy.get('[data-testid=password-input]').type('Memory-V1-Local-482!', { log: false });
      cy.get('form[data-testid=login-form]').submit();
      cy.location('pathname').should('eq', '/');
      cy.contains('button', 'Чат поддержки').click();
      cy.get('[aria-label="Продолжение подбора"]').contains('button', /^Продолжить$/).click();
      cy.contains('h2', 'Продолжаем подбор').should('be.visible');
      cy.get('textarea[aria-label=Message]').type('Поменяй бренд на Nord, цвет на зелёный и бюджет до 8000 рублей.{enter}');
      cy.contains('[role="dialog"] article h3', 'Nord Green 7500', { timeout: 35000 }).should('be.visible');
      cy.contains('[role="dialog"] article h3', 'Nord Green 9200').should('not.exist');
    });
  });

  it('verifies the logged-out behavior independently from an authorized buyer', () => {
    prepareScenario('guest', 7);
    cy.origin(shop, () => {
      cy.visit('/');
      cy.contains('button', 'Чат поддержки').click();
      cy.contains('[role=dialog]', 'Войдите, чтобы открыть чат поддержки').should('be.visible');
      cy.get('textarea[aria-label=Message]').should('not.exist');
      cy.get('[aria-label="Продолжение подбора"]').should('not.exist');
      cy.contains('[role=dialog]', 'Подбор открыт.').should('not.exist');
      cy.visit('/auth?activeTab=login');
      cy.get('[data-testid=email-input]').type('decline@memory-v1.example.test');
      cy.get('[data-testid=password-input]').type('Memory-V1-Local-482!', { log: false });
      cy.get('form[data-testid=login-form]').submit();
      cy.location('pathname').should('eq', '/');
      cy.contains('button', 'Чат поддержки').click();
      cy.contains('Подбор открыт.').should('be.visible');
      cy.get('[role=dialog]').contains('button', /^Close$/).click();
      cy.contains('a', /^Профиль$/).click();
      cy.contains('[role=menuitem]', /^Выйти$/).click();
      cy.contains('a', /^Регистрация$/).should('be.visible');
      cy.contains('button', 'Чат поддержки').click();
      cy.contains('[role=dialog]', 'Войдите, чтобы открыть чат поддержки').should('be.visible');
      cy.get('textarea[aria-label=Message]').should('not.exist');
      cy.get('[aria-label="Продолжение подбора"]').should('not.exist');
      cy.contains('[role=dialog]', 'Подбор открыт.').should('not.exist');
    });
  });
});
