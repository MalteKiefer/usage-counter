async function request(url, options) {
  const res = await fetch(url, options);
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
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
export const deleteMeter = (id) => request(`/api/meters/${id}`, { method: 'DELETE' });

export const fetchReadings = (objectId) => request(`/api/objects/${objectId}/readings`);
export const createReadings = (readings) => request('/api/readings', json('POST', readings));
export const deleteReading = (id) => request(`/api/readings/${id}`, { method: 'DELETE' });

export const fetchRefills = (objectId) => request(`/api/objects/${objectId}/refills`);
export const createRefill = (objectId, refill) => request(`/api/objects/${objectId}/refills`, json('POST', refill));
export const deleteRefill = (id) => request(`/api/refills/${id}`, { method: 'DELETE' });

export const fetchTankLevels = (objectId) => request(`/api/objects/${objectId}/tank-levels`);
export const createTankLevel = (objectId, entry) =>
  request(`/api/objects/${objectId}/tank-levels`, json('POST', entry));
export const deleteTankLevel = (id) => request(`/api/tank-levels/${id}`, { method: 'DELETE' });

export async function fetchBackup() {
  const res = await fetch('/api/backup');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

export const restoreBackup = (text) =>
  request('/api/restore?confirm=replace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
