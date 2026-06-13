export function normalize(value: string): string {
  return value.toLowerCase().replace(/[-_\s]/g, '');
}
