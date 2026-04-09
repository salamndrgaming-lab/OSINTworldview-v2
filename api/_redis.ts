// Copyright (C) 2026 Chip / salamndrgaming-lab
// Shared inline Redis helper for Vercel Edge Functions.
// Per architecture rules: copy this into each api/ file, never import across files.
// This canonical version exists for reference only.

export async function upstashGet<T>(key: string): Promise<T | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!resp.ok) return null;
  const { result } = await resp.json();
  if (!result) return null;
  return typeof result === 'string' ? JSON.parse(result) : result;
}
