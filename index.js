require('dotenv').config();
const socketSrv = require('./services/socket');
require('./services/build');


const {MASTER_HOST, SOCKET_PATH, SOCKET_NAMESPACE, TOKEN} = process.env;

socketSrv.connect(MASTER_HOST, SOCKET_PATH, SOCKET_NAMESPACE, TOKEN);
