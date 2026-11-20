export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
export async function publicSubmit(path: string, payload: unknown) {
  const response = await fetch(`${API_BASE}/api/public/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Your submission could not be completed. Please try again.');
  return data;
}
