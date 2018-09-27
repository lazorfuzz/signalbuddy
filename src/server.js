import config from 'getconfig';
import fs from 'fs';
import os from 'os';
import sticky from 'sticky-session';
import farmhash from 'farmhash';
import net from 'net';
import cluster from 'cluster';
import http from 'http';
import https from 'https';
import sockets from './sockets';

const port = parseInt(process.env.PORT || config.server.port, 10);
const redisEndpoint = process.env.REDIS_ENDPOINT || config.redis.endpoint;
const redisPort = process.env.REDIS_PORT || config.redis.port;
const numProcesses = os.cpus().length;

if (cluster.isMaster) {
  const workers = [];
  const spawn = (i) => {
    workers[i] = cluster.fork();
    // Persistence
    workers[i].on('exit', (code, signal) => {
      console.log(`Worker ${i} exited with signal ${signal}`);
      console.log('Respawning worker', i);
      spawn(i);
    });
  };

  for (let i = 0; i < numProcesses; i += 1) {
    console.log(`Starting worker ${i + 1}`);
    spawn(i);
  }

  const workerIndex = (ip, len) => // Farmhash is the fastest and works with IPv6, too
    farmhash.fingerprint32(ip) % len;

  // Create the outside facing server listening on our port.
  const masterServer = net.createServer({ pauseOnConnect: true }, (connection) => {
    // We received a connection and need to pass it to the appropriate
    // worker. Get the worker for this connection's source IP and pass
    // it the connection.
    const worker = workers[workerIndex(connection.remoteAddress, numProcesses)];
    worker.send('sticky-session:connection', connection);
  }).listen(port);

  console.log(`Listening at ${config.server.secure ? 'https' : 'http'}://localhost:${port}/`);
} else {
  const serverHandler = (req, res) => {
    if (req.url === '/healthcheck') {
      console.log(Date.now(), 'healthcheck');
      res.writeHead(200);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end(`worker: ${cluster.worker.id}`);
  };

  let server = null;

  // Create an http(s) server instance to that socket.io can listen to
  if (config.server.secure) {
    server = https.Server({
      key: fs.readFileSync(process.env.PRIV_KEY || config.server.key),
      cert: fs.readFileSync(process.env.CERT || config.server.cert),
      passphrase: config.server.password
    }, serverHandler);
  } else {
    server = http.Server(serverHandler);
  }
  if (!sticky.listen(server, port)) {
    // Master
  } else {
    // Worker
  }
  server.listen(0);
  sockets(server, Object.assign({ redisEndpoint, redisPort }, config));
  if (config.uid) process.setuid(config.uid);
  process.on('message', (message, connection) => {
    if (message !== 'sticky-session:connection') {
      return;
    }
    // Emulate a connection event on the server by emitting the
    // event with the connection the master sent us.
    server.emit('connection', connection);

    connection.resume();
  });
}
