export async function requestJson<T>(endpoint: string, body?: object, timeoutMs = 7500): Promise<T> {
  const response = await fetch(endpoint, {
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
    ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'The bridge could not complete the request.');
  return result;
}
