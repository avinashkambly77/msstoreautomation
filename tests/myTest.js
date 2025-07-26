const { Builder, By } = require('selenium-webdriver');
const assert = require('assert');

describe('Google Search Test', function () {
  this.timeout(30000);
  let driver;

  before(async () => {
    driver = await new Builder().forBrowser('chrome').build();
  });

  it('should open Google and search something', async () => {
    await driver.get('https://www.google.com');
    const searchBox = await driver.findElement(By.name('q'));
    await searchBox.sendKeys('OpenAI');
    await searchBox.submit();
    const title = await driver.getTitle();
    assert.ok(title.toLowerCase().includes('openai'));
  });

  after(async () => {
    await driver.quit();
  });
});
