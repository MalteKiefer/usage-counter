const FAILURES = { failed: 'login.failed', denied: 'login.denied' };

// The server sends ?login=failed or ?login=denied back to the app. Only listed values map to a message.
export function loginFailureKey(search) {
  const value = new URLSearchParams(search).get('login');
  return value !== null && Object.hasOwn(FAILURES, value) ? FAILURES[value] : null;
}
