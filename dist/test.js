'use strict';

var _tape = require('tape');

var _tape2 = _interopRequireDefault(_tape);

var _getconfig = require('getconfig');

var _getconfig2 = _interopRequireDefault(_getconfig);

var _server = require('./server');

var _server2 = _interopRequireDefault(_server);

var _socket = require('socket.io-client');

var _socket2 = _interopRequireDefault(_socket);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var test = _tape2.default.createHarness();

var output = test.createStream();
output.pipe(process.stdout);
output.on('end', function () {
  console.log('Tests complete, killing server.');
  process.exit(0);
});

var socketURL = void 0;
if (_getconfig2.default.server.secure) {
  socketURL = 'https://localhost:' + _getconfig2.default.server.port;
} else {
  socketURL = 'http://localhost:' + _getconfig2.default.server.port;
}

var socketOptions = {
  transports: ['websocket'],
  'force new connection': true,
  secure: _getconfig2.default.server.secure
};

test('it should not crash when sent an empty message', function (t) {
  t.plan(1);
  var client = _socket2.default.connect(socketURL, socketOptions);

  client.on('connect', function () {
    client.emit('message');
    t.ok(true);
  });
});