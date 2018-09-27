import socketIO from 'socket.io';
import uuid from 'node-uuid';
import crypto from 'crypto';
import redisAdapter from 'socket.io-redis';
import { safeCb } from './util';

export default (server, config) => {
  const io = socketIO.listen(server);
  io.adapter(redisAdapter({ host: config.redis.host, port: config.redis.port }));
  io.on('connection', (client) => {
    client.resources = {
      screen: false,
      video: true,
      audio: false
    };

    // pass a message to another id
    client.on('message', (details) => {
      if (!details) return;
      const otherClient = io.to(details.to);
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
          type
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
        getClientCount(name)
          .then((count) => {
            if (count > config.rooms.maxClients) {
              removeFeed();
            }
          });
      }
      // leave any existing rooms
      removeFeed();
      getClients(name, (err, clients) => safeCb(cb)(err, clients));
      client.join(name);
      client.room = name;
    }

    function getClients(roomName, callback) {
      describeRoom(roomName)
        .then((description) => {
          const obj = { clients: {} };
          description.forEach((k) => {
            obj.clients[k] = client.resources;
          });
          safeCb(callback)(null, obj);
        })
        .catch(err => safeCb(callback)(err, null));
    }

    function getClientCount(roomName, callback) {
      clientsInRoom(roomName)
        .then((num) => {
          if (roomName) safeCb(callback)(num);
        });
    }

    // we don't want to pass "leave" directly because the
    // event type string of "socket end" gets passed too.
    client.on('disconnect', () => {
      removeFeed();
    });

    client.on('leave', () => {
      removeFeed();
    });

    client.on('create', (name, cb) => {
      if (arguments.length === 2) {
        cb = (typeof cb === 'function') ? cb : () => {};
        name = name || uuid();
      } else {
        cb = name;
        name = uuid();
      }
      // check if exists
      io.in(name).clients((err, clients) => {
        if (clients && clients.length) {
          safeCb(cb)('taken');
        } else {
          join(name);
          safeCb(cb)(null, name);
        }
      });
    });

    /*
    client.on('trace', (data) => {
      // console.log('trace', JSON.stringify([data.type, data.session, data.prefix, data.peer, data.time, data.value]));
    });
    */

    // tell client about stun and turn servers and generate nonces
    client.emit('stunservers', config.stunservers || []);

    // create shared secret nonces for TURN authentication
    // the process is described in draft-uberti-behave-turn-rest
    const credentials = [];
    // allow selectively vending turn credentials based on origin.
    const { origin } = client.handshake.headers;
    if (!config.turnorigins || config.turnorigins.includes(origin)) {
      config.turnservers.forEach((server) => {
        const hmac = crypto.createHmac('sha1', server.secret);
        // default to 86400 seconds timeout unless specified
        const username = `${Math.floor(new Date().getTime() / 1000) + (parseInt(server.expiry || 86400, 10))}`;
        hmac.update(username);
        credentials.push({
          username,
          credential: hmac.digest('base64'),
          urls: server.urls || server.url
        });
      });
    }
    client.emit('turnservers', credentials);
  });

  function describeRoom(roomName) {
    return new Promise((resolve, reject) => {
      io.in(roomName).clients((err, clients) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(clients);
      });
    });
  }

  function clientsInRoom(roomName) {
    return new Promise((resolve, reject) => {
      io.in(roomName).clients((err, clients) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(clients.length);
      });
    });
  }
};
