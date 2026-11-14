const backend = 'http://127.0.0.1:41820';
const card = '[aria-label="Продолжение подбора"]';
const composer = 'textarea[aria-label=Message]';
const prompt = 'Подбери синие кроссовки Aurora до 6000 рублей.';
const change = 'Поменяй бренд на Nord, цвет на зелёный и бюджет до 8000 рублей.';
const newSearch = 'Подбери кроссовки до 10000 рублей.';
const resumeButton = /^Продолжить с прежними условиями$/;

const clock = (day, reset, reconnect) => cy.request(backend + '/__acceptance').then(({ body }) => {
  const token = body.match(/X-Acceptance-Token":"([a-f0-9]{64})/)[1];
  const request = (path) => cy.request({
    method: 'POST',
    url: backend + '/__acceptance/' + path,
    headers: { Origin: backend, 'X-Acceptance-Token': token },
  });
  return request('time/' + day).then(() =>
    reset ? request('reset/' + reset) : reconnect ? request('reconnect/' + reconnect) : undefined);
});

const login = (user) => {
  cy.intercept('POST', '**/auth/login').as('login');
  cy.visit('/auth?activeTab=login');
  cy.get('[data-testid=email-input]').type(user + '@memory-v1.example.test');
  cy.get('[data-testid=password-input]').type('Memory-V1-Local-482!', { log: false });
  cy.get('form[data-testid=login-form]').submit();
  cy.wait('@login').its('response.statusCode').should('equal', 200);
  cy.location('pathname').should('eq', '/');
};

const open = () => {
  cy.contains('button', 'Чат поддержки').click();
  cy.get(composer).should('be.enabled');
};

const send = (message) => {
  cy.get(composer).should('be.enabled').type(message);
  cy.get('button[aria-label="Send message"]').click();
};

const resultTitle = (title) => cy.contains('[role="dialog"] article h3', title, { timeout: 35000 });
const selectedCard = () => {
  cy.get(card).contains('h2', 'Продолжаем подбор').should('be.visible');
  cy.get(card).contains('button', resumeButton).should('be.enabled');
};

const selectOffer = () => {
  cy.get(card).contains('h2', 'Продолжим прошлый подбор?').should('be.visible');
  cy.get(card).should('contain.text', 'Aurora').contains('button', /^Продолжить$/).click();
  selectedCard();
};

function trackChatSends() {
  const messages = [];
  cy.on('window:before:load', (win) => {
    const sendFrame = win.WebSocket.prototype.send;
    win.WebSocket.prototype.send = function (frame) {
      if (typeof frame === 'string' && frame.startsWith('42') && frame.includes('[')) {
        const [event, payload] = JSON.parse(frame.slice(frame.indexOf('[')));
        if (event === 'chat:send_message') messages.push(payload);
      }
      return sendFrame.call(this, frame);
    };
  });
  return messages;
}

describe('Full isolated store', () => {
  it('signs in, searches the live catalog and saves the episode', () => {
    clock(0, 'verify-new');
    login('verify-new');
    open();
    cy.get(card).should('not.exist');
    send(prompt);
    resultTitle('Aurora Blue 5000').should('be.visible');
    clock(7);
    cy.reload();
    open();
    cy.get(card).should('contain.text', 'Aurora');
  });

  it('restores a confirmed offer after reconnect and reload and searches only on explicit action', () => {
    const sends = trackChatSends();
    clock(0, 'verify');
    clock(7);
    login('verify');
    open();
    selectOffer();

    clock(7, undefined, 'verify').its('body.disconnected').should('be.greaterThan', 0);
    cy.get(composer).should('be.enabled');
    selectedCard();
    cy.reload();
    open();
    selectedCard();
    cy.get(card).contains('button', /^Продолжить$/).should('not.exist');
    cy.get('[role="dialog"] a[href^="/product/"]').should('not.exist');
    cy.then(() => expect(sends).to.have.length(0));

    cy.get(card).contains('button', resumeButton).click();
    resultTitle('Aurora Blue 5000').should('be.visible');
    cy.get(card).should('not.exist');
    cy.then(() => {
      expect(sends).to.have.length(1);
      expect(sends[0].consultationAction).to.equal('resume_unchanged');
      expect(sends[0].continuationOfferId).to.be.a('string');
      expect(sends[0].clientMessageId).to.be.a('string');
    });
  });

  it('starts a separate consultation after reload without attaching the previous offer', () => {
    const sends = trackChatSends();
    clock(0, 'verify');
    clock(7);
    login('verify');
    open();
    selectOffer();

    cy.get(card).contains('button', /^Начать новый подбор$/).click();
    cy.get(card).should('not.exist');
    cy.get(composer).should('have.focus');
    cy.contains('Расскажите, что хотите подобрать.').should('be.visible');
    cy.reload();
    open();
    cy.get(card).should('not.exist');
    cy.contains('Расскажите, что хотите подобрать.').should('be.visible');
    cy.contains('Подбор открыт.').should('be.visible');
    cy.then(() => expect(sends).to.have.length(0));

    send(newSearch);
    resultTitle('Atlas Red 6800').should('be.visible');
    cy.then(() => {
      expect(sends).to.have.length(1);
      expect(sends[0].content).to.equal(newSearch);
      expect(sends[0]).not.to.have.property('continuationOfferId');
      expect(sends[0]).not.to.have.property('consultationAction');
    });
  });

  it('refines a confirmed offer from free text', () => {
    clock(0, 'verify');
    clock(7);
    login('verify');
    open();
    selectOffer();
    send(change);
    resultTitle('Nord Green 7500').should('be.visible');
    cy.contains('[role="dialog"] article h3', 'Nord Green 9200').should('not.exist');
  });

  it('suppresses a dismissed card and keeps a separate buyer and guest isolated', () => {
    clock(0, 'verify-decline');
    clock(7);
    login('verify-decline');
    open();
    cy.get(card).contains('button', 'Не сейчас').click();
    cy.get(card).should('not.exist');
    clock(13);
    cy.reload();
    open();
    cy.get(card).should('not.exist');
    cy.clearAllCookies();
    cy.clearAllLocalStorage();
    login('other');
    open();
    cy.get(card).should('not.exist');
    cy.clearAllCookies();
    cy.clearAllLocalStorage();
    cy.visit('/');
    cy.contains('button', 'Чат поддержки').click();
    cy.contains('[role=dialog]', 'Войдите, чтобы открыть чат поддержки').should('be.visible');
    cy.get(composer).should('not.exist');
    cy.get(card).should('not.exist');
  });

  it('offers a paused episode on day 14 and hides an expired episode on day 90', () => {
    clock(0, 'verify');
    clock(14);
    login('verify');
    open();
    cy.get(card).should('contain.text', 'Aurora');
    cy.clearAllCookies();
    cy.clearAllLocalStorage();
    clock(0, 'verify-decline');
    clock(89);
    login('verify-decline');
    open();
    cy.get(card).should('contain.text', 'Aurora');
    clock(90);
    cy.reload();
    open();
    cy.get(card).should('not.exist');
  });
});
