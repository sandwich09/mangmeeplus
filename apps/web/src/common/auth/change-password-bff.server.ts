import { internalApiV1Base } from '../api/internal-api-base';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function forwardPasswordChange(
  accessToken: string,
  body: { currentPassword?: string; newPassword: string },
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  return fetchImpl(`${internalApiV1Base()}/auth/password/change`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}
