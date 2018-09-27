'use strict';

var _getconfig = require('getconfig');

var _getconfig2 = _interopRequireDefault(_getconfig);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _os = require('os');

var _os2 = _interopRequireDefault(_os);

var _stickySession = require('sticky-session');

var _stickySession2 = _interopRequireDefault(_stickySession);

var _farmhash = require('farmhash');

var _farmhash2 = _interopRequireDefault(_farmhash);

var _net = require('net');

var _net2 = _interopRequireDefault(_net);

var _cluster = require('cluster');

var _cluster2 = _interopRequireDefault(_cluster);

var _http = require('http');

var _http2 = _interopRequireDefault(_http);

var _https = require('https');

var _https2 = _interopRequireDefault(_https);

var _sockets = require('./sockets');

var _sockets2 = _interopRequireDefault(_sockets);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* global console */
var port = parseInt(process.env.PORT || _getconfig2.default.server.port, 10);
var redisEndpoint = process.env.REDIS_ENDPOINT || _getconfig2.default.redis.endpoint;
var redisPort = process.env.REDIS_PORT || _getconfig2.default.redis.port;
var numProcesses = _os2.default.cpus().length;

if (_cluster2.default.isMaster) {
  var workers = [];
  var spawn = function spawn(i) {
    workers[i] = _cluster2.default.fork();
    // Optional: Restart worker on exit
    workers[i].on('exit', function (code, signal) {
      console.log('respawning worker', i);
      spawn(i);
    });
  };

  for (var i = 0; i < numProcesses; i += 1) {
    console.log('Starting worker ' + (i + 1));
    spawn(i);
  }

  var workerIndex = function workerIndex(ip, len) {
    return (// Farmhash is the fastest and works with IPv6, too
      _farmhash2.default.fingerprint32(ip) % len
    );
  };

  // Create the outside facing server listening on our port.
  var masterServer = _net2.default.createServer({ pauseOnConnect: true }, function (connection) {
    // We received a connection and need to pass it to the appropriate
    // worker. Get the worker for this connection's source IP and pass
    // it the connection.
    var worker = workers[workerIndex(connection.remoteAddress, numProcesses)];
    worker.send('sticky-session:connection', connection);
  }).listen(port);

  console.log('Listening at ' + (_getconfig2.default.server.secure ? 'https' : 'http') + '://localhost:' + port + '/');
} else {
  var serverHandler = function serverHandler(req, res) {
    if (req.url === '/healthcheck') {
      console.log(Date.now(), 'healthcheck');
      res.writeHead(200);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end('worker: ' + _cluster2.default.worker.id);
  };

  var server = null;

  // Create an http(s) server instance to that socket.io can listen to
  if (_getconfig2.default.server.secure) {
    server = _https2.default.Server({
      key: _fs2.default.readFileSync(process.env.PRIV_KEY || _getconfig2.default.server.key),
      cert: _fs2.default.readFileSync(process.env.CERT || _getconfig2.default.server.cert),
      passphrase: _getconfig2.default.server.password
    }, serverHandler);
  } else {
    server = _http2.default.Server(serverHandler);
  }

  if (!_stickySession2.default.listen(server, port)) {
    // Master code
    /* server.once('listening', function() {
     }); */
  } else {
      // Worker code
    }

  server.listen(0);

  (0, _sockets2.default)(server, Object.assign({ redisEndpoint: redisEndpoint, redisPort: redisPort }, _getconfig2.default));

  if (_getconfig2.default.uid) process.setuid(_getconfig2.default.uid);

  process.on('message', function (message, connection) {
    if (message !== 'sticky-session:connection') {
      return;
    }
    // Emulate a connection event on the server by emitting the
    // event with the connection the master sent us.
    server.emit('connection', connection);

    connection.resume();
  });
}