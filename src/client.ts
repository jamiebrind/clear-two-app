import { directConnection } from './connection.ts';

export async function requestJson<T>(endpoint: string, body?: object, timeoutMs = 7500): Promise<T> {
  if (directConnection) {
    const { requestDirect } = await import('./directClient.ts');
    return await requestDirect(endpoint, body) as T;
  }
  let response: Response;
  let result;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    response = await fetch(endpoint, {
      cache: 'no-store', signal,
      ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    result = await response.json();
  } catch (error) {
    if (signal.aborted) throw new Error(body
      ? 'The bridge timed out. Refresh the room to check whether the change took effect.'
      : 'The bridge timed out. Check its connection and try again.');
    if (error instanceof SyntaxError) throw new Error('The bridge sent an unreadable response. Reopen Clear Two from the bridge address.');
    throw new Error('Could not reach the Clear Two bridge. Check that it is running and connected to your network.');
  }
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'The bridge could not complete the request.');
  return result;
}
