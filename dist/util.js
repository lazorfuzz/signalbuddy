'use strict';

function safeCb(cb) {
  if (typeof cb === 'function') {
    return cb;
  }
  return function () {};
}

module.exports = {
  safeCb: safeCb
};