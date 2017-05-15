const plist = require('simple-plist');
const obj = plist.readFileSync('default.metadata.plist');
console.log(JSON.stringify(obj, null, 4));
