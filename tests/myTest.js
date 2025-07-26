const puppeteer = require('puppeteer');
const assert = require('assert');

describe('Google Homepage', function () {
  it('should have the correct title', async function () {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.goto('https://www.google.com');
    const title = await page.title();
    assert.strictEqual(title.includes('Google'), true);
    await browser.close();
  });
});
