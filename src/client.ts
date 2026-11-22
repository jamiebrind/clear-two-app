export async function requestJson<T>(endpoint: string, body?: object): Promise<T> {
  const response = await fetch(endpoint, {
    cache: 'no-store',
    signal: AbortSignal.timeout(7500),
    ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'The bridge could not complete the request.');
  return result;
}
