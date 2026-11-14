// Thin wrapper around the Express API (server/api.js).
async function request(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  crew: () => request('GET', '/crew'),
  createCrew: (person) => request('POST', '/crew', person),
  deleteCrew: (id) => request('DELETE', `/crew/${id}`),
  dashboard: (id, missionId) =>
    request('GET', `/crew/${id}/dashboard${missionId ? `?mission=${missionId}` : ''}`),
  tasks: (id) => request('GET', `/crew/${id}/tasks`),
  setTask: (id, taskId, done) => request('POST', `/crew/${id}/tasks/${taskId}`, { done }),
  guide: () => request('GET', '/guide'),
};
