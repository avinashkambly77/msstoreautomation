const puppeteer = require('puppeteer');
const assert = require('assert');

describe('Google Homepage', function () {
  it('should have the correct title', async function () {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // <== Fix here
    });

    const page = await browser.newPage();
    await page.goto('https://www.google.com');
    const title = await page.title();
    assert.ok(title.includes('Google'));
    await browser.close();
  });
});
