const CAD = new Intl.NumberFormat("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Integer cents as "$1,234.50", the way the app shows amounts. */
export const money = (cents: number): string => `$${CAD.format(cents / 100)}`;

/** A tax line on a subtotal, rounded half-up to the cent like the app's tax engine. */
export const taxOn = (subtotal: number, rate: number): number => Math.round(subtotal * rate + 1e-9);
