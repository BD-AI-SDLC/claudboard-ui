export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

export function formatCost(cents: number | null | undefined): string | null {
  if (cents == null) return null
  return `$${(cents / 100).toFixed(2)}`
}
