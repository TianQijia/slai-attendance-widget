const fs = require('node:fs');
const path = require('node:path');
const { swipeHtml, swipeData } = require('../tests/swipe-fixture');
const output = path.resolve(__dirname, '../android/app/build/generated/slaiTestAssets');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'swipe.html'), swipeHtml());
for (const number of [1, 2, 3]) fs.writeFileSync(path.join(output, `page-${number}.json`), JSON.stringify(swipeData(number)));
