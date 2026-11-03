export type ReferenceUnit = "mm" | "cm" | "in";
const millimeters: Record<ReferenceUnit, number> = { mm: 1, cm: 10, in: 25.4 };
// Accept decimal dots/commas, but do not silently interpret fractions,
// thousands separators, scientific notation, or text as a measured distance.
export function referenceSize(
  width: string,
  height: string,
  unit: ReferenceUnit,
) {
  const parse = (text: string) => {
    const value = text.trim();
    if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value)) return NaN;
    return (
      Math.round(Number(value.replace(",", ".")) * millimeters[unit] * 1e6) /
      1e6
    );
  };
  const width_mm = parse(width),
    height_mm = parse(height);
  if (
    ![width_mm, height_mm].every(
      (n) => Number.isFinite(n) && n >= 10 && n <= 2000,
    )
  )
    return null;
  return { width_mm, height_mm };
}
export function calibrationLabel(method: string) {
  if (method === "known_rectangle") return "a measured rectangle";
  if (method === "reference_card") return "a reference card";
  if (method === "arkit_plane" || method === "arcore_plane")
    return "phone surface tracking";
  return "the supplied size reference";
}
