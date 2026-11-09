const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (d: number) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtEur = (v: number | null | undefined) => (v == null ? "—" : eur.format(v));
export const fmtSigned = (v: number | null | undefined) => (v == null ? "—" : (v > 0 ? "+" : "") + eur.format(v));
export const fmtPct = (v: number | null | undefined, d = 2) => (v == null ? "—" : (v > 0 ? "+" : "") + num(d).format(v * 100) + " %");
export const fmtPctPlain = (v: number | null | undefined, d = 1) => (v == null ? "—" : num(d).format(v * 100) + " %");
export const fmtNum = (v: number | null | undefined, d = 2) => (v == null ? "—" : num(d).format(v));

export function fmtPrice(v: number | null | undefined) {
  if (v == null) return "—";
  return num(v >= 1000 ? 1 : v >= 1 ? 2 : 6).format(v);
}

export function fmtQty(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 8 }).format(v);
}

export function fmtDate(v: string | null | undefined, withSeconds = false) {
  if (!v) return "—";
  const d = new Date(v);
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: withSeconds ? "2-digit" : undefined });
}

export function fmtDay(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function ago(v: string | null | undefined) {
  if (!v) return "—";
  const s = Math.max(0, (Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return `il y a ${Math.round(s)} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
}

export const tone = (v: number | null | undefined) => (v == null || v === 0 ? "" : v > 0 ? "up" : "down");
