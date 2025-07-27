const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

async function writeExcelReport(results, reportName) {
  if (!Array.isArray(results) || results.length === 0) {
    console.warn('No data to write.');
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Test Result');

  // Dynamically get column headers from the first result object
  const columnKeys = Object.keys(results[0]);
  const columnNames = columnKeys.map(key => ({
    header: key.charAt(0).toUpperCase() + key.slice(1), // Capitalize header
    key: key,
    width: 20
  }));

  sheet.columns = columnNames;

  sheet.getRow(1).font = { bold: true };

  // Add rows dynamically
  results.forEach(result => {
    sheet.addRow(result);
  });

  // Adjust column widths automatically
  sheet.columns.forEach(column => {
    let maxLength = 10;
    column.eachCell({ includeEmpty: true }, cell => {
      const cellLength = cell.value ? cell.value.toString().length : 0;
      if (cellLength > maxLength) maxLength = cellLength;
    });
    column.width = maxLength + 2;
  });

  const dir = path.join(__dirname, '../report');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  const inputFileName = 'report_' + reportName;
  const fileName = await getTimestampedFilename(inputFileName, 'xlsx');
  const filePath = path.join(dir, fileName);
  await workbook.xlsx.writeFile(filePath);
  console.log(`✅ Excel report generated at ${filePath}`);
}

async  function getTimestampedFilename(baseName, extension = 'log') {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // 01-12
  const day = String(now.getDate()).padStart(2, '0');        // 01-31
  const hours = String(now.getHours()).padStart(2, '0');     // 00-23
  const minutes = String(now.getMinutes()).padStart(2, '0'); // 00-59
  const seconds = String(now.getSeconds()).padStart(2, '0'); // 00-59

  const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
  return `${baseName}_${timestamp}.${extension}`;
}


module.exports = { writeExcelReport };
