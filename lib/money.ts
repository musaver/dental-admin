// Money helpers for the Fee Calculations module.
// All amounts are whole PKR integers (matching courses.price).

export function formatPKR(amount: number | null | undefined): string {
  const n = Number(amount || 0);
  return `Rs. ${n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface DiscountInput {
  discountType: "percentage" | "fixed" | string;
  value: number;
}

// Discount amount for a given base, clamped so it never exceeds the base.
export function computeDiscountAmount(base: number, discount: DiscountInput): number {
  if (!discount) return 0;
  const raw =
    discount.discountType === "percentage"
      ? Math.round((base * Number(discount.value || 0)) / 100)
      : Number(discount.value || 0);
  return Math.max(0, Math.min(raw, base));
}

// Derive an invoice status from amounts. `waived`/`refunded` are set explicitly elsewhere.
export function deriveInvoiceStatus(totalAmount: number, paidAmount: number): "unpaid" | "partial" | "paid" {
  if (paidAmount <= 0) return "unpaid";
  if (paidAmount >= totalAmount) return "paid";
  return "partial";
}

// Current period string in YYYY-MM form.
export function currentPeriod(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
