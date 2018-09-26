function safeCb(cb) {
  if (typeof cb === 'function') {
    return cb;
  }
  return () => {};
}

module.exports = {
  safeCb
};
