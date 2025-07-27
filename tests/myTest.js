// File: test/testRunner.js

const puppeteer = require('puppeteer');
const { expect } = require('chai');
const minimist = require('minimist');
const { writeExcelReport } = require('../utils/reportWriter');
const { personalizerItems } = require('../filesToCheckPersonalizer.json');

const args = minimist(process.argv.slice(2));
const VIEWPORT = { width: 1920, height: 1080 };

const allResults = [];
const initialFailedItems = [];

function createTestResult(item) {
  return {
    personalizerId: item.personalizerId,
    type: '',
    url: item.url,
    elementSelector: item.elementSelector,
    domOrder: [],
    rankOrder: [],
    rankApiCall: false,
    rewardApiCall: false,
    rankFirstElement: '',
    domFirstElemet: '',
    domOrderCheckWithRankOrder: false,
    rankEventId: '',
    rewardEventId: '',
    rewardWeightList: item.weight,
    rewardWeight: '',
  };
}

function getLocaleFromUrl(url) {
  const path = new URL(url).pathname;
  const parts = path.split('/').filter(Boolean);
  return parts.length > 0 ? parts[0] : null;
}

async function closeModals(page) {
  try {
    await page.evaluate(() => {
      document.querySelector('.modal-backdrop')?.remove();
      document.querySelector('.modal')?.remove();
      document.querySelector('#modalsRenderedAfterPageLoad')?.remove();
    });
  } catch (err) {
    console.warn('⚠️ Popup close failed:', err.message);
  }
}

async function runTest(item, label = '') {
  const {
    url,
    personalizerId,
    elementSelector,
    recommendation
  } = item;

  const locale = getLocaleFromUrl(url);

  const testTitle = recommendation
    ? `🎯 Recommendation Flow - personalizerId : ${personalizerId} & locale : ${locale}`
    : `🔀 Card Shuffle Flow - personalizerId : ${personalizerId} & locale : ${locale}`;

  describe(`${label ? `♻️ Retry ${label}` : '🧪'} ${testTitle} - ${url}`, function () {
    this.timeout(60000);

    let browser, page;
    let rankResponse, rewardRequest;
    const result = createTestResult(item);

    before(async () => {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
        defaultViewport: null,
      });
      result.type = label ? `Retry ${label} - ${testTitle}` : testTitle;
      page = await browser.newPage();
      await page.setRequestInterception(true);

      page.on('request', req => req.continue());

      page.on('response', async (response) => {
        const resUrl = response.url();
        if (resUrl.includes('/personalizerwrapperapi/v01/rank') && resUrl.includes(personalizerId)) {
          try {
            rankResponse = await response.json();
            result.rankApiCall = true;
            result.rankEventId = rankResponse.eventId;
          } catch (err) {
            console.error('❌ Failed to parse /rank:', err.message);
          }
        }

        if (resUrl.includes('/reward') && resUrl.includes(personalizerId)) {
          try {
            rewardRequest = {
              url: resUrl,
              status: response.status(),
              method: response.request().method(),
              payload: JSON.parse(response.request().postData()),
            };
            result.rewardApiCall = rewardRequest.status === 200;
            result.rewardEventId = rewardRequest.payload.eventId;
            result.rewardWeight = rewardRequest.payload.weight;
          } catch (err) {
            console.error('❌ Failed to parse /reward:', err.message);
          }
        }
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
      await closeModals(page);
      await new Promise(res => setTimeout(res, 10000));
    });

    it(`${personalizerId} - validate rank vs DOM`, async () => {
      try {
        await page.waitForSelector(elementSelector, { timeout: 40000 });

        const domOrder = await page.$$eval(`${elementSelector}`, els =>
          els.map(el => el.getAttribute('data-offerid') || el.getAttribute('data-offerkey'))
        );

        expect(domOrder.length).to.be.greaterThan(0);
        expect(rankResponse).to.not.be.null;

        const rankOrder = rankResponse.ranking.map(r => r.id).slice(0, 4);
        const rewardActionId = rankResponse.rewardActionId;

        result.domOrder = domOrder;
        result.rankOrder = rankOrder;
        result.rankFirstElement = rankOrder[0];
        result.domFirstElemet = domOrder[0];
        result.domOrderCheckWithRankOrder = domOrder[0] === rewardActionId;

        const cardLinks = await page.$$(elementSelector + ' a');
        expect(cardLinks.length).to.be.greaterThan(0);

        await Promise.all([
          cardLinks[0].click(),
          page.waitForNavigation({ waitUntil: 'domcontentloaded' })
        ]);

        await new Promise(res => setTimeout(res, 10000));

        expect(domOrder[0]).to.equal(rewardActionId);
        expect(domOrder.slice(0, rankOrder.length)).to.deep.equal(rankOrder);
      } catch (error) {
        throw error;
      }
    });

    after(async () => {
      allResults.push(result);
      await browser.close();
      console.log(`🧼 Browser closed for personalizerId ${personalizerId}`);
    });
  });
}

(async () => {
  // Run all initial tests
  for (const item of personalizerItems) {
    try {
      await runTest(item);
    } catch (err) {
      initialFailedItems.push(item);
    }
  }

  // Retry logic
  let retryCount = 0;
  const maxRetries = 2;
  let currentFailedItems = [...initialFailedItems];

  while (currentFailedItems.length > 0 && retryCount < maxRetries) {
    retryCount++;
    console.log(`\n🔁 Retry Attempt ${retryCount} for ${currentFailedItems.length} failed tests...\n`);
    const newFailures = [];

    for (const item of currentFailedItems) {
      try {
        await runTest(item, retryCount);
      } catch {
        newFailures.push(item);
      }
    }

    currentFailedItems = newFailures;
  }

  // Final report
  if (allResults.length > 0) {
    try {
      await writeExcelReport(allResults, 'personalizer_report');
      console.log('📊 Excel report successfully written!');
    } catch (err) {
      console.error('❌ Failed to write Excel report:', err.message);
    }
  } else {
    console.warn('⚠️ No results to write to Excel.');
  }
})();
