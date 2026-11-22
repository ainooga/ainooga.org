// A broken .env loader or redirect must not send a credential off the test server.
const origin = process.env.TEST_CLI_ORIGIN;
if (
  !/^http:\/\/127\.0\.0\.1:[1-9]\d*$/.test(origin ?? '') ||
  new URL(origin).origin !== origin
) {
  throw new Error('Expected numeric loopback origin with a test port');
}
const fetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  if (new URL(request.url).origin !== origin || request.redirect !== 'error') {
    throw new Error('Unexpected CLI destination or redirect policy');
  }
  return fetch(request);
};
