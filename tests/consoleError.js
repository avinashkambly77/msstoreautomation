const puppeteer = require('puppeteer');
const assert = require('assert');
const { writeExcelReport } = require('../utils/reportWriter');
const path = require('path');
const XLSX = require('xlsx');
const fs = require('fs');

// GitHub Actions environment detection
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const browserInfo = process.env.BROWSER || 'chrome';

// Browser configuration for different environments
const getBrowserConfig = () => {
  if (isGitHubActions) {
    return {
      headless: 'new', // Use new headless mode
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-client-side-phishing-detection',
        '--disable-crash-reporter',
        '--disable-oor-cors',
        '--no-crash-upload',
        '--disable-gl-drawing-for-tests',
        '--disable-logging',
        '--disable-new-content-rendering-timeout',
        '--disable-offer-store-unmasked-wallet-cards',
        '--disable-popup-blocking',
        '--disable-print-preview',
        '--disable-prompt-on-repost',
        '--disable-speech-api',
        '--disable-sync-test',
        '--hide-scrollbars',
        '--ignore-gpu-blacklist',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--no-pings',
        '--password-store=basic',
        '--use-gl=swiftshader',
        '--use-mock-keychain',
        `--window-size=1920,1080`
      ],
      defaultViewport: {
        width: 1920,
        height: 1080
      }
    };
  } else {
    // Local development configuration
    const edgePathObj = {
      chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    };
    
    return {
      headless: process.env.HEADLESS !== 'false',
      args: [`--window-size=1920,1080`],
      defaultViewport: null,
      executablePath: edgePathObj[browserInfo]
    };
  }
};

function readExcelAsJson(filePath, sheetName) {
  if (!fs.existsSync(filePath)) {
    console.error(`Excel file not found: ${filePath}`);
    return [];
  }

  try {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new Error(`Sheet '${sheetName}' not found in Excel file.`);
    }
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    return data.map(row => ({
      url: typeof row.url === 'object' ? row.url.hyperlink || row.url.text : row.url,
      experimentId: String(row.exp_id),
      errorList: typeof row.type === 'string' ? row.type.split(',') : row.type
    }));
  } catch (error) {
    console.error('Error reading Excel file:', error.message);
    return [];
  }
}

// Read input from the Excel file
const excelFilePath = path.resolve(__dirname, '../filesToCheckPersonalizer.xlsx');
let pages = [];
const sheetName = 'consoleError';

try {
  pages = readExcelAsJson(excelFilePath, sheetName);
  console.log('Loaded personalizer items:', pages.length, 'items');
} catch (err) {
  console.error('Excel read failed:', err.message);
}

// Fallback test data if Excel file is not available
if (pages.length === 0) {
  console.warn('No data loaded from Excel file. Using fallback test data.');
  pages = [
    {
      url: 'https://example.com',
      experimentId: 'test-exp-1',
      errorList: ['log', 'pageerror']
    }
  ];
}

function defineTest() {
  describe('Console log check using Puppeteer', function () {
    this.timeout(60000); // Increased timeout for GitHub Actions

    let browser;
    const consoleMessages = [];

    before(async function() {
      console.log('Environment:', isGitHubActions ? 'GitHub Actions' : 'Local');
      console.log('Browser config:', getBrowserConfig());
      
      try {
        browser = await puppeteer.launch(getBrowserConfig());
        console.log('Browser launched successfully');
      } catch (error) {
        console.error('Failed to launch browser:', error);
        throw error;
      }
    });

    pages.forEach((item) => {
      const { url, experimentId, errorList } = item;

      if (!url || !experimentId || !errorList) {
        console.warn(`Skipping item with missing data: ${JSON.stringify(item)}`);
        return;
      }
      
      if (!Array.isArray(errorList)) {
        console.warn(`Invalid errorList for item ${experimentId}: ${errorList}`);
        return;
      }

      it(`should capture console messages for ${url}`, async function() {
        this.timeout(30000); // Per-test timeout
        
        let page;
        try {
          page = await browser.newPage();

          // Enhanced error handling for GitHub Actions
          page.on('console', msg => {
            const message = msg.text();
            if (errorList.includes('log') || message.includes(experimentId)) {
              consoleMessages.push({ 
                type: msg.type(), 
                message: message,
                URL: url,
                timestamp: new Date().toISOString()
              });
            }
          });

          page.on('pageerror', error => {
            if (errorList.includes('pageerror') || error.message.includes(experimentId)) {
              consoleMessages.push({ 
                type: 'PAGE ERROR', 
                message: error.message,
                URL: url,
                timestamp: new Date().toISOString()
              });
            }
          });

          page.on('requestfailed', req => {
            const failure = req.failure();
            if (failure && failure.errorText) {
              const errorText = failure.errorText;
              if (errorList.includes('requestfailed') || errorText.includes(experimentId)) {
                consoleMessages.push({ 
                  type: 'REQUEST FAILED', 
                  message: errorText,
                  URL: url,
                  timestamp: new Date().toISOString()
                });
              }
            }
          });

          // Navigate with better error handling
          console.log(`Navigating to: ${url}`);
          await page.goto(url, { 
            waitUntil: 'networkidle2',
            timeout: 20000 
          });

          // Wait for page to fully load
          await new Promise(resolve => setTimeout(resolve, 5000)); // Reduced wait time

          const errors = consoleMessages.filter(msg => msg.message.includes(experimentId));
          
          if (errors.length > 0) {
            console.log(`Found ${errors.length} errors for ${experimentId}:`, errors);
          }
          
          assert.strictEqual(errors.length, 0, 
            `Console errors found on ${url}: ${JSON.stringify(errors, null, 2)}`);

        } catch (error) {
          console.error(`Test failed for ${url}:`, error.message);
          throw error;
        } finally {
          if (page) {
            await page.close();
          }
        }
      });
    });

    after(async function() {
      try {
        const nameOfFile = `consoleLogs_${new Date().toISOString().split('T')[0]}`;
        console.log(`Writing report: ${nameOfFile}`);
        console.log(`Total console messages collected: ${consoleMessages.length}`);
        
        if (typeof writeExcelReport === 'function') {
          await writeExcelReport(consoleMessages, nameOfFile);
        } else {
          console.warn('writeExcelReport function not available');
          // Fallback: write to JSON
          fs.writeFileSync(`${nameOfFile}.json`, JSON.stringify(consoleMessages, null, 2));
        }
      } catch (error) {
        console.error('Failed to write report:', error);
      }

      if (browser) {
        await browser.close();
        console.log('Browser closed successfully');
      }
    });
  });
}

// Export for testing or run directly
if (require.main === module) {
  defineTest();
} else {
  module.exports = { defineTest, readExcelAsJson };
}