const program = require('commander');
const socketSrv = require('./services/socket');
require('./services/build');

program
    .version('0.1.0')
    .option('-h, --master-host <masterHost>', 'Master host')
    .option('-p, --socket-path <socketPath>', 'Socket path')
    .option('-n, --socket-namespace <socketNamespace>', 'Socket namespace')
    .option('-t, --token <token>', 'Cluster token')
    .parse(process.argv);

socketSrv.connect(program.masterHost, program.socketPath, program.socketNamespace, program.token);
