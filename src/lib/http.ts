export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try { return JSON.parse(text) as unknown; } catch { return { message: text.slice(0, 500) }; }
}

export async function providerError(response: Response, provider: string): Promise<never> {
  const body = await readJson(response);
  let message = typeof body === "object" && body !== null && "error" in body
    ? JSON.stringify(body.error) : JSON.stringify(body);
  const knownSecrets = [process.env.META_PAGE_ACCESS_TOKEN, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REFRESH_TOKEN, process.env.OPENAI_API_KEY].filter((secret): secret is string => Boolean(secret));
  for (const secret of knownSecrets) message = message.split(secret).join("[redacted]");
  message = message.replace(/("?(?:access_token|refresh_token|client_secret)"?\s*[:=]\s*")([^"]+)(")/gi, "$1[redacted]$3");
  throw new Error(`${provider} returned ${response.status}: ${message.slice(0, 500)}`);
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}
