import type { Category, Report } from "../api/types";

const trades: Record<Category, string> = {
  other: "home repair contractor",
  crack: "building repair contractor",
  water_stain: "water damage restoration",
  mold_mildew: "mold remediation contractor",
  caulking: "caulking contractor",
  appliance_error: "appliance repair technician",
};
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
export function suggestedRepairTrade(
  report: Pick<Report, "category" | "pro" | "red_flags">,
): string {
  const trade = clean(report.pro?.trade ?? "");
  if (
    trade &&
    !/^(qualified|licensed)?\s*(professional|contractor|specialist|home maintenance professional)$/i.test(
      trade,
    )
  )
    return trade.slice(0, 120);
  if (report.red_flags.includes("gas")) return "licensed gas technician";
  if (
    report.red_flags.includes("electrical_panel") ||
    report.red_flags.includes("flooding_near_electrics")
  )
    return "licensed electrician";
  if (report.red_flags.includes("structural_distress"))
    return "structural engineer";
  if (report.red_flags.includes("asbestos"))
    return "asbestos abatement contractor";
  return trades[report.category];
}

// Only these two user-visible fields leave the app. No report, photo, room note,
// job identifier or inferred home address is included in the Maps URL.
export function repairSearchUrl(trade: string, area: string): string {
  const term = clean(trade),
    location = clean(area);
  if (!term)
    throw new Error("Enter the type of repair professional to search for.");
  if (term.length > 120 || location.length > 100)
    throw new Error("Shorten the repair type or search area and try again.");
  const query = location ? `${term} in ${location}` : `${term} near me`;
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  if (url.length > 2048)
    throw new Error("Shorten the repair type or search area and try again.");
  return url;
}
