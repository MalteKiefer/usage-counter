// An error the server answered with: a code and the values for its message.
export class ApiError extends Error {
  constructor(code, params) {
    super(code);
    this.code = code;
    this.params = params;
  }
}

async function request(url, options, read = (res) => res.json()) {
  const res = await fetch(url, options);
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.error ?? 'http.status', { status: res.status, ...body?.params });
  }
  return read(res);
}

// Message text for an error, translated. Nested causes (for example a row in a backup) are translated too.
export function errorText(err, t) {
  if (!(err instanceof ApiError)) return err.message;
  return translateCode(err.code, err.params, t);
}

function translateCode(code, params = {}, t) {
  const cause = params.cause ? translateCode(params.cause.code, params.cause.params, t) : undefined;
  return t(`err.${code}`, { ...params, cause });
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const fetchObjects = () => request('/api/objects');
export const createObject = (object) => request('/api/objects', json('POST', object));
export const updateObject = (id, object) => request(`/api/objects/${id}`, json('PUT', object));
export const deleteObject = (id) => request(`/api/objects/${id}`, { method: 'DELETE' });

export const fetchMeters = (objectId) => request(`/api/objects/${objectId}/meters`);
export const createMeter = (objectId, meter) => request(`/api/objects/${objectId}/meters`, json('POST', meter));
export const updateMeter = (id, meter) => request(`/api/meters/${id}`, json('PUT', meter));
export const deleteMeter = (id) => request(`/api/meters/${id}`, { method: 'DELETE' });

export const fetchReadings = (objectId) => request(`/api/objects/${objectId}/readings`);
export const createReadings = (readings) => request('/api/readings', json('POST', readings));
export const deleteReading = (id) => request(`/api/readings/${id}`, { method: 'DELETE' });

export const fetchRefills = (objectId) => request(`/api/objects/${objectId}/refills`);
export const createRefill = (meterId, refill) => request(`/api/meters/${meterId}/refills`, json('POST', refill));
export const deleteRefill = (id) => request(`/api/refills/${id}`, { method: 'DELETE' });

export const fetchTankLevels = (objectId) => request(`/api/objects/${objectId}/tank-levels`);
export const createTankLevel = (meterId, entry) => request(`/api/meters/${meterId}/tank-levels`, json('POST', entry));
export const deleteTankLevel = (id) => request(`/api/tank-levels/${id}`, { method: 'DELETE' });

export const fetchBackup = () => request('/api/backup', undefined, (res) => res.blob());

export const restoreBackup = (text) =>
  request('/api/restore?confirm=replace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });

export const fetchSession = () => request('/api/session');
export const savePreferences = (prefs) => request('/api/me/preferences', json('PUT', prefs));
export const logout = () => request('/auth/logout', { method: 'POST' });
