// The server sends errors as { error: "..." }.
export async function errorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error ?? `${fallback} (status ${res.status})`;
}
