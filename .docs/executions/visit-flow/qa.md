# Visit flow QA

Run the branch as described in [plan.md](plan.md#running-it), signed in as `hannah@birchbark.example` (password `demo1234`). Check each item on web (8700) and on the iOS simulator unless it says otherwise. Record the results in [progress.md](progress.md).

## Setup for the pass

- In Inbox → Forms, set one form to send on booking with a signature required, and make sure at least one of today's clients hasn't answered it.
- Give one client on today's agenda an active package for their service.
- Have one active gift card code with a balance.
- Make sure one of today's visits has a pending deposit.

## Check-in

1. Today shows "2 to do" or "Ready" on each upcoming visit. The schedule shows the same marker on the visit.
2. Check in on a visit with the unanswered form opens the sheet. The form is listed with Resend link and Open here, and the pending deposit is listed with Collect deposit.
3. Open here shows the form full screen. Submitting it and closing the page removes it from the list.
4. Collect deposit takes the deposit, and the item clears.
5. Checking in with an item still outstanding works. The audit entry for the check-in lists that item.
6. The confirmation line shows "… checked in" with Undo. Undo returns the visit to Check in.
7. The schedule's booking panel offers Check in on today's visit and opens the same sheet.
8. A staff member sees and checks in only their own visits.
9. The reminder message (in Mailpit at 8715) lists the outstanding form with its link, and the manage page shows the same list. Once it's answered, the manage page says "You're all set".

## Checkout

10. Checkout from Today opens the register with the visit on the ticket and Back to Today.
11. Paying a started visit by card or cash completes it. Today shows it done, and the schedule stops asking for Complete or No-show.
12. A visit paid before its start time stays open.
13. With a payee staff member on a service rate, the paid visit shows a pending service earning in Staff pay.
14. The client with a package sees "Use package (n left)" on the visit's line. Using it completes the visit, takes it off the ticket and lowers the sessions left by one.
15. Entering the gift card code applies credit up to what's owed, and the rest is paid by card. Refunding the sale restores the gift card's balance.
16. Send as invoice turns the ticket into an invoice with the same lines and clears the register. Paying the invoice completes the visit.
17. The paid screen suggests the next visit at the client's usual interval with the same staff member, and opens the composer prefilled.
18. Writing a visit note and sending it posts a message in the client's thread with the manage link. The manage page shows the booking's photos.

## Both together

19. One client goes through the whole path: reminder, manage page, check-in with the checklist, checkout with a gift card credit, next visit booked and note sent. The review request becomes eligible the next morning (run `make worker`, or check that the visit is completed).
20. The en-XA pseudo-locale (`VITE_PSEUDO_LOCALE=1`) shows no untranslated text in the sheet, the register additions or the paid screen.
