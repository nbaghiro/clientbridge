# Product decisions taken by e2e cases

Where a case met behaviour whose intent wasn't settled, it asserts the current behaviour, or the behaviour the findings 1 to 16 fixes chose, and the choice is listed here for review before merge.

## SALE-E2E-11: what front-desk staff see after a sale

**Question.** The case expected a staff member to open their own sale from the sales history and find a receipt resend but no refund. The web app shows the History view and sale details only to roles that can manage payments, so staff never reach that panel.

**Chosen.** Current behaviour. The case checks that the payment confirmation offers no refund, that `?view=history` leaves staff on New sale with only New sale and Orders on offer, and that the API refuses their refund, restock and void with 403.

**Why.** `useSalesViews` and the Orders board gate sale details with `canManagePayments` on purpose, and the server refuses the same actions, so a read-only sale panel for staff would be a new feature.

## FLOW-04-B: what the merge preview counts as a note

**Question.** The duplicate's note is about its pet, Juniper. The merge preview lists "1 booking" and "Pets: Juniper" but no note, because its footprint counts only notes on the client itself. The client record shows both kinds under Notes.

**Chosen.** Current behaviour. The case asserts the preview lists exactly the booking and the pet, then checks that the note arrives on the kept client's timeline with the pet, after the merge and after a reload.

**Why.** A note about a pet belongs to the pet and moves with it, and the app-core SQL test pins the client-only count. Counting pet notes in the preview is a reasonable change, but it's a product choice rather than a defect.

## FLOW-03-A: a sold-out line in a kept shop cart

**Question.** The shopper's order for the last unit is refused once a desk sale takes it. When they go back to the shop, the session still holds their cart, so the card shows "Sold out" with a quantity stepper at 1 rather than a disabled Add button.

**Chosen.** Current behaviour. The case asserts the Sold out tag, a disabled Increase button and no Add button while the unit is gone, then, after the desk refund, the low-stock tag, an enabled Decrease button and the line still in the order summary.

**Why.** Connect keeps the cart in session storage on purpose, so a reload during checkout resumes the order (the SALE-E2E-03 fix). Dropping a refused line from the cart would be a separate product change.
