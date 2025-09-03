const puppeteer = require('puppeteer');
const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { writeExcelReport } = require('../utils/reportWriter');

const VIEWPORT = { width: 1920, height: 1080 };
const allResults = [];
const testFailures = new Map(); // personalizerId -> retryCount
const MAX_RETRIES = 2;
const BATCH_SIZE = 5; // adjust as needed

// ========== Excel Reader ==========
function readExcelAsJson(filePath, sheetName) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet '${sheetName}' not found in Excel file.`);
  }
  const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return data.map(row => ({
    url: typeof row.url === 'object' ? row.url.hyperlink || row.url.text : row.url,
    personalizerId: String(row.personalizerId),
    elementSelector: row.elementSelector,
    recommendation: row.recommendation === true || row.recommendation === 'TRUE',
    weight: typeof row.weight === 'string' ? row.weight.split(',').map(Number) : row.weight
  }));
}

const excelFilePath = path.resolve(__dirname, '../filesToCheckPersonalizer.xlsx');
let personalizerItems = [];
const sheetName = 'PersonalizerItems';

try {
  personalizerItems = readExcelAsJson(excelFilePath, sheetName);
} catch (err) {
  console.error('Excel read failed:', err.message);
}

if (!fs.existsSync('screenshots')) {
  fs.mkdirSync('screenshots');
}

// ========== Utils ==========
function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function createTestResult(item) {
  return {
    personalizerId: item.personalizerId,
    type: '',
    url: item.url,
    elementSelector: item.elementSelector,
    recommendationNotLoaded: false,
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
    error: null,
    screenshot: '',
    batchNumber: ''
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

async function getTimestampedFilename(baseName, extension = 'png') {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `${baseName}_${timestamp}.${extension}`;
}

// ========== Test Definition ==========
function defineTest(item, retryAttempt = 0, batchNumber = 1) {
  const { url, personalizerId, elementSelector, recommendation } = item;
  const locale = getLocaleFromUrl(url);
  const label = retryAttempt === 0 ? '🧪' : `♻️ Retry ${retryAttempt}`;
  const testTitle = recommendation
    ? `🎯 Recommendation Flow - personalizerId : ${personalizerId} & locale : ${locale}`
    : `🔀 Card Shuffle Flow - personalizerId : ${personalizerId} & locale : ${locale}`;

  describe(`${label} Batch ${batchNumber} | ${testTitle} - ${url}`, function () {
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
      result.type = recommendation ? 'Recommendation' : 'Card Shuffle';
      result.batchNumber = batchNumber;

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

    it(`${personalizerId} - validate rank vs DOM`, async function () {
      try {
        await page.waitForSelector(elementSelector, { timeout: 40000 });

        const domOrder = await page.$$eval(`${elementSelector}`, els =>
          els.map(el => el.getAttribute('data-offerid') || el.getAttribute('data-offerkey'))
        );

        expect(domOrder.length).to.be.greaterThan(0);
        // Add flag if rank API was not called or rankResponse is missing/invalid (recommendation not loaded)
        if (!result.rankApiCall || !rankResponse || !Array.isArray(rankResponse.ranking)) {
          result.recommendationNotLoaded = true;
        }
        expect(rankResponse).to.not.be.null;

        const rankOrderLength = Math.min(rankResponse.ranking.length, 4);
        const rankOrder = rankResponse.ranking.slice(0, rankOrderLength).map(r => r.id);
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
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 })
        ]);

        await new Promise(res => setTimeout(res, 10000));

        expect(domOrder[0]).to.equal(rewardActionId);

        expect(domOrder.slice(0, rankOrder.length)).to.deep.equal(rankOrder);
      } catch (error) {
        result.error = error.message;

        const currentRetry = testFailures.get(personalizerId) || 0;
        testFailures.set(personalizerId, currentRetry + 1);

        const fileName = await getTimestampedFilename(`${personalizerId}_retry${retryAttempt}`, 'png');
        const screenshotPath = path.join('screenshots', fileName);
        await page.screenshot({ path: screenshotPath });
        result.screenshot = screenshotPath;

        throw error;
      }
    });

    after(async () => {
      allResults.push(result);
      await browser.close();
    });
  });
}

// ========== Batch Execution ==========
const batches = chunkArray(personalizerItems, BATCH_SIZE);

batches.forEach((batch, batchIndex) => {
  describe(`🗂️ Batch ${batchIndex + 1}`, function () {
    batch.forEach(item => defineTest(item, 0, batchIndex + 1));
  });
});

// ========== Global Retries ==========
after(async function () {
  for (let retry = 1; retry <= MAX_RETRIES; retry++) {
    const itemsToRetry = personalizerItems.filter(item => {
      const retriesSoFar = testFailures.get(item.personalizerId) || 0;
      return retriesSoFar >= retry;
    });

    if (itemsToRetry.length === 0) break;

    console.log(`\n🔁 Scheduling Retry ${retry} for ${itemsToRetry.length} items...\n`);
    itemsToRetry.forEach(item => {
      const batchNumber = batches.findIndex(b => b.some(i => i.personalizerId === item.personalizerId)) + 1;
      defineTest(item, retry, batchNumber);
    });
  }
});

// ========== Final Report ==========
after(async function () {
  if (allResults.length > 0) {
    try {
      await writeExcelReport(allResults, 'personalizer_report');
      console.log('📊 Excel report successfully written!');
    } catch (err) {
      console.error('Failed to write Excel report:', err.message);
    }
  } else {
    console.warn('No results to write to Excel.');
  }
});
