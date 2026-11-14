module.exports = { video: false, screenshotOnRunFailure: true, viewportWidth: 1280, viewportHeight: 900,
  defaultCommandTimeout: 14000, pageLoadTimeout: 90000, e2e: {
    baseUrl: 'http://127.0.0.1:41821', specPattern: ['browser.cy.js', 'acceptance-panel.cy.js'], supportFile: false
  }
};
