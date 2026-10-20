# Demo editions

One fully seeded demo business for each vertical the product serves, for showing a solution to a prospective customer and for testing it. Each one has logins for an owner and staff, a catalog with images, clients with photos, months of history, upcoming bookings, documents and engagement, posted through the same ledger paths the product uses.

## Verticals

| # | Vertical | Business | Subject kind | Province | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Pet grooming and daycare | Birchbark Pet Studio | pet | BC | done |
| 2 | Home services and trades | Northlight Security | site | BC | done |
| 3 | Dog walking and pet sitting | Cedar Coast Pet Care | pet | BC | expand |
| 4 | Home cleaning | new | property | AB | todo |
| 5 | Hair and beauty salon | Maple and Main Hair Studio | none | ON | done |
| 6 | Personal training and fitness | Ridgeline Strength Studio | none | AB | done |
| 7 | Tutoring and lessons | Lakeside Learning Studio | student | ON | done |
| 8 | Massage and wellness | new | none | BC | todo |
| 9 | Photography | Fieldnote Photography | none | ON | done |
| 10 | Landscaping and lawn care | new | property | AB | todo |
| 11 | Tattoo studio | new | none | BC | todo |

Auto detailing is out of scope: it needs a `vehicle` subject kind.

## Order

1. A shared demo engine: staff and calendar allocation, visits to invoices, payments and the ledger, deposits, packages, subscriptions, documents, photos and storyline stages. Northlight is ported onto it with its seeded data unchanged, and `demo_validate` and the fixture scripts work for any demo business. The seed and test baseline times are measured before and after.
2. Each new vertical as a data module on the engine, built in parallel, each through the gate.
3. Images and portraits from Pexels and Unsplash, credited in `CREDITS.md`, with no portraits on clients with a negative storyline.
4. Each trade page's demo link points to its business, and `engineering.md` gets a login table and walkthrough per vertical.

When every vertical is done, the durable parts move into `engineering.md` and this folder is deleted.
