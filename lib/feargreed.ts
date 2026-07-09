export interface FearGreed {
  value: string;
  value_classification: string;
}

export async function getFearGreed(): Promise<FearGreed | null> {
  try {
    const res = await fetch('/api/feargreed/fng/?limit=1');
    const json = await res.json();
    return json?.data?.[0] ?? null;
  } catch {
    return null;
  }
}
