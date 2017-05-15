var pkg = require('../package.json');

var args = require('yargs')
    .usage(pkg.name + ' ' + pkg.version + '\n' + pkg.description + '\n\nUsage: $0 [options]')
    .describe('h', 'show help')
    .describe('b', 'mqtt broker url. See https://github.com/mqttjs/MQTT.js#connect-using-a-url')
    .describe('m', 'mapping JSON file')
    .demandOption(['m'])
    .alias({
        'b': 'broker',
        'h': 'help',
        'm': 'mapping'
    })
    .default({
        'b': 'mqtt://127.0.0.1',
    })
    .check(argv => argv.broker.match(/^(?:mqtt|mqtts|tcp|tls|ws|wss)/))
    .version()
    .help('help')
    .argv;

export {
    args as default
};
