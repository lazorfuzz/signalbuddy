'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _arguments = arguments;

var _socket = require('socket.io');

var _socket2 = _interopRequireDefault(_socket);

var _nodeUuid = require('node-uuid');

var _nodeUuid2 = _interopRequireDefault(_nodeUuid);

var _crypto = require('crypto');

var _crypto2 = _interopRequireDefault(_crypto);

var _socket3 = require('socket.io-redis');

var _socket4 = _interopRequireDefault(_socket3);

var _util = require('./util');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = function (server, config) {
  var io = _socket2.default.listen(server);
  io.adapter((0, _socket4.default)({ host: config.redis.host, port: config.redis.port }));
  io.on('connection', function (client) {
    client.resources = {
      screen: false,
      video: true,
      audio: false
    };

    // pass a message to another id
    client.on('message', function (details) {
      if (!details) return;
      var otherClient = io.to(details.to);
      if (!otherClient) return;
      details.from = client.id;
      otherClient.emit('message', details);
    });

    client.on('join', join);
    client.on('getClients', getClients);
    client.on('getClientCount', getClientCount);

    function removeFeed(type) {
      if (client.room) {
        io.in(client.room).emit('remove', {
          id: client.id,
          type: type
        });
        if (!type) {
          client.leave(client.room);
          client.room = undefined;
        }
      }
    }

    function join(name, cb) {
      // sanity check
      if (typeof name !== 'string') return;
      // check if maximum number of clients reached
      if (config.rooms && config.rooms.maxClients > 0) {
        getClientCount(name).then(function (count) {
          if (count > config.rooms.maxClients) {
            removeFeed();
          }
        });
      }
      // leave any existing rooms
      removeFeed();
      getClients(name, function (err, clients) {
        return (0, _util.safeCb)(cb)(err, clients);
      });
      client.join(name);
      client.room = name;
    }

    function getClients(roomName, callback) {
      describeRoom(roomName).then(function (description) {
        var obj = { clients: {} };
        description.forEach(function (k, i) {
          obj.clients[k] = client.resources;
        });
        (0, _util.safeCb)(callback)(null, obj);
      }).catch(function (err) {
        return (0, _util.safeCb)(callback)(err, null);
      });
    }

    function getClientCount(roomName, callback) {
      clientsInRoom(roomName).then(function (num) {
        if (roomName) (0, _util.safeCb)(callback)(num);
      });
    }

    // we don't want to pass "leave" directly because the
    // event type string of "socket end" gets passed too.
    client.on('disconnect', function () {
      removeFeed();
    });

    client.on('leave', function () {
      removeFeed();
    });

    client.on('create', function (name, cb) {
      if (_arguments.length === 2) {
        cb = typeof cb === 'function' ? cb : function () {};
        name = name || (0, _nodeUuid2.default)();
      } else {
        cb = name;
        name = (0, _nodeUuid2.default)();
      }
      // check if exists
      var room = io.nsps['/'].adapter.rooms[name];
      if (room && room.length) {
        (0, _util.safeCb)(cb)('taken');
      } else {
        join(name);
        (0, _util.safeCb)(cb)(null, name);
      }
    });

    // support for logging full webrtc traces to stdout
    // useful for large-scale error monitoring
    client.on('trace', function (data) {
      // console.log('trace', JSON.stringify([data.type, data.session, data.prefix, data.peer, data.time, data.value]));
    });

    // tell client about stun and turn servers and generate nonces
    client.emit('stunservers', config.stunservers || []);

    // create shared secret nonces for TURN authentication
    // the process is described in draft-uberti-behave-turn-rest
    var credentials = [];
    // allow selectively vending turn credentials based on origin.
    var origin = client.handshake.headers.origin;

    if (!config.turnorigins || config.turnorigins.includes(origin)) {
      config.turnservers.forEach(function (server) {
        var hmac = _crypto2.default.createHmac('sha1', server.secret);
        // default to 86400 seconds timeout unless specified
        var username = '' + (Math.floor(new Date().getTime() / 1000) + parseInt(server.expiry || 86400, 10));
        hmac.update(username);
        credentials.push({
          username: username,
          credential: hmac.digest('base64'),
          urls: server.urls || server.url
        });
      });
    }
    client.emit('turnservers', credentials);
  });

  function describeRoom(roomName) {
    return new Promise(function (resolve, reject) {
      io.in(roomName).clients(function (err, clients) {
        if (err) {
          reject(err);
          return;
        }
        resolve(clients);
      });
    });
  }

  function clientsInRoom(roomName) {
    return new Promise(function (resolve, reject) {
      io.in(roomName).clients(function (err, clients) {
        if (err) {
          reject(err);
          return;
        }
        resolve(clients.length);
      });
    });
  }
};