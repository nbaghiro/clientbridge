"""Birchbark's forms and contracts: the questions and clauses a grooming studio sends."""

from clientbridge.models.documents import FieldInput

# name, input, label, help, required, options
type Field = tuple[str, FieldInput, str, str | None, bool, tuple[str, ...]]

INTAKE_FIELDS: tuple[Field, ...] = (
    ("owner_name", "text", "Your full name", None, True, ()),
    (
        "owner_phone",
        "phone",
        "Mobile number",
        "We text reminders and let you know when your pet is ready.",
        True,
        (),
    ),
    ("home_address", "address", "Home address", None, False, ()),
    ("pet_name", "text", "Pet's name", None, True, ()),
    ("species", "select", "Species", None, True, ("Dog", "Cat")),
    ("breed", "text", "Breed or mix", None, False, ()),
    ("dob", "date", "Date of birth", "An estimate is fine for a rescue.", False, ()),
    (
        "weight_kg",
        "number",
        "Weight in kg",
        "Small-dog grooms are for dogs up to 11 kg.",
        False,
        (),
    ),
    (
        "sex",
        "select",
        "Sex",
        None,
        False,
        ("Female, spayed", "Female, not spayed", "Male, neutered", "Male, not neutered"),
    ),
    (
        "health",
        "multiselect",
        "Health conditions we should know about",
        "Older pets and those with these conditions may need a shorter groom with rest breaks.",
        False,
        (
            "Arthritis or joint pain",
            "Heart condition",
            "Breathing difficulty",
            "Seizures",
            "Skin allergies",
            "Ear infections",
            "Recent surgery",
            "None",
        ),
    ),
    (
        "medications",
        "longtext",
        "Medications and allergies",
        "Include any shampoo or product your pet reacts to.",
        False,
        (),
    ),
    ("vet_clinic", "text", "Veterinary clinic", None, True, ()),
    ("vet_phone", "phone", "Clinic phone", None, True, ()),
    ("rabies_date", "date", "Last rabies vaccine", None, True, ()),
    ("dhpp_date", "date", "Last DHPP vaccine (FVRCP for cats)", None, True, ()),
    (
        "bordetella_date",
        "date",
        "Last Bordetella vaccine",
        "Needed for classes and the play group.",
        False,
        (),
    ),
    (
        "vax_record",
        "file",
        "Vaccination record",
        "A PDF from your clinic or a clear photo of the card.",
        False,
        (),
    ),
    (
        "handling",
        "multiselect",
        "Behaviour and handling",
        None,
        False,
        (
            "Nervous with dryers",
            "Dislikes nail trims",
            "Sensitive paws",
            "May nip when handled",
            "Reactive to other dogs",
            "Food motivated",
            "Easy to handle",
        ),
    ),
    (
        "handling_notes",
        "longtext",
        "Anything else that helps us handle your pet",
        None,
        False,
        (),
    ),
    (
        "groom_style",
        "select",
        "Usual groom",
        None,
        False,
        (
            "Breed standard",
            "Short all over (puppy cut)",
            "Tidy and trim only",
            "Bath and brush only",
        ),
    ),
    (
        "groom_notes",
        "longtext",
        "Grooming preferences",
        "Length, face and ear style, and anything you'd like left alone.",
        False,
        (),
    ),
    ("emergency_name", "text", "Emergency contact name", None, True, ()),
    (
        "emergency_phone",
        "phone",
        "Emergency contact phone",
        "Someone we can call if we can't reach you.",
        True,
        (),
    ),
    (
        "photo",
        "image",
        "A recent photo of your pet",
        "It helps the team recognise your pet at drop-off.",
        False,
        (),
    ),
    (
        "consent_vet",
        "checkbox",
        "If my pet needs urgent care during a visit and you can't reach me, Birchbark may take "
        "them to my clinic or the nearest open clinic. I'll pay the clinic's costs.",
        None,
        True,
        (),
    ),
    (
        "consent_matting",
        "checkbox",
        "I understand that a matted coat may need a short shave-down instead of a brush-out.",
        None,
        True,
        (),
    ),
    (
        "consent_photos",
        "checkbox",
        "Birchbark may share photos of my pet on social media.",
        "You can change this at any time.",
        False,
        (),
    ),
)
CLASS_FIELDS: tuple[Field, ...] = (
    (
        "class",
        "select",
        "Class",
        None,
        True,
        (
            "Puppy Socialization (group)",
            "Small-Dog Play Group",
            "Nail Trim Clinic",
            "Senior Dog Gentle Groom Workshop",
        ),
    ),
    ("pet_name", "text", "Dog's name", None, True, ()),
    (
        "age",
        "select",
        "Age",
        None,
        True,
        ("Under 6 months", "6 to 12 months", "1 to 7 years", "Over 7 years"),
    ),
    (
        "bordetella_date",
        "date",
        "Last Bordetella vaccine",
        "Puppies need their second set of shots at least a week before the first class.",
        True,
        (),
    ),
    ("vax_record", "file", "Vaccination record", None, False, ()),
    (
        "around_dogs",
        "select",
        "How does your dog do around other dogs?",
        "This helps us group dogs by size and energy.",
        True,
        ("Plays well", "Shy at first", "Can be pushy", "Reactive on leash", "Not sure yet"),
    ),
    (
        "handler_name",
        "text",
        "Who will come with your dog?",
        "Puppy classes and the workshop need an adult handler in the room.",
        False,
        (),
    ),
    ("handler_phone", "phone", "Handler's phone", None, False, ()),
    (
        "ack_play",
        "checkbox",
        "I understand that dogs in a group can scuffle or pass on minor illnesses, and that "
        "staff will separate dogs or end play when they need to.",
        None,
        True,
        (),
    ),
    (
        "ack_leash",
        "checkbox",
        "My dog will arrive on a leash and stay leashed until staff bring them into the room.",
        None,
        True,
        (),
    ),
    (
        "ack_cancel",
        "checkbox",
        "A class place can't be refunded within 24 hours of the session, but it can move to "
        "another session once.",
        None,
        True,
        (),
    ),
)

FEEDBACK_FIELDS: tuple[Field, ...] = (
    ("rating", "rating", "How did the visit go?", None, True, ()),
    (
        "highlights",
        "multiselect",
        "What went well?",
        None,
        False,
        ("The finished groom", "Gentle handling", "On time", "Communication", "Value"),
    ),
    ("comments", "longtext", "Anything we could do better?", None, False, ()),
    (
        "follow_up",
        "checkbox",
        "You can contact me about this feedback.",
        None,
        False,
        (),
    ),
)

# the first version, which earlier clients signed
WAIVER_V1 = (
    "I authorize Birchbark Pet Studio to groom my pet. I understand that severely "
    "matted coats may require a humane shave-down, and that grooming can occasionally "
    "expose pre-existing skin or health conditions. In an emergency I authorize "
    "Birchbark to seek veterinary care at my expense. Cancellations within 24 hours "
    "may incur a 50% fee."
)
WAIVER_V2 = "\n\n".join(
    (
        "This agreement covers grooming, bathing and nail care for your pet at Birchbark Pet "
        "Studio, 1207 Government Street, Victoria. It is demo text for a fictional business, "
        "not legal advice.",
        "Services and prices\nWe confirm the service and its price when you book. If your "
        "pet needs extra work that changes the price, we'll call you before we start it.",
        "Matting and shave-downs\nA matted coat can't always be brushed out without hurting "
        "your pet. When it can't, we'll clip the coat short under the mats and call you first "
        "if we can reach you. De-matting is charged at $15 for each 15 minutes. A shave-down "
        "can reveal redness, scrapes or skin irritation that the mats were hiding.",
        "Senior pets and medical conditions\nGrooming is physically demanding for older pets "
        "and for pets with heart, breathing, joint or seizure conditions. Tell us about any "
        "condition or medication before the visit. We may shorten the groom, add rest breaks "
        "or stop if your pet is distressed, and we'll charge only for the work done.",
        "Vaccinations and parasites\nPets must be up to date on rabies and DHPP, or FVRCP for "
        "cats. We can't groom a pet with fleas, an open wound or a contagious condition. If we "
        "find fleas, we'll treat your pet for $20 and ask you to collect them.",
        "Emergencies\nIf your pet is hurt or becomes unwell, we'll stop, give first aid and "
        "call you. If we can't reach you, you authorize us to take your pet to your clinic or "
        "the nearest open clinic, and you agree to pay the clinic's costs.",
        "Cancellations and late arrivals\nPlease give us 24 hours' notice to cancel or move a "
        "visit. Cancelling with less notice, or not arriving, costs 50% of the booked service, "
        "and any deposit you've paid goes toward that fee. If you arrive more than 15 minutes "
        "late, we may shorten the service or rebook it.",
        "Pick-up\nWe'll text you when your pet is ready. Please collect them within an hour. "
        "After that, supervised waiting is $10 for each hour.",
        "Photos\nWe take before and after photos for your pet's record. We post them on social "
        "media only if you've agreed on your intake form, and you can change that at any time.",
        "Payment\nPayment is due at pick-up by card, cash or e-Transfer. Invoices sent by "
        "text are due within 14 days. A deposit taken at booking is applied to the final invoice.",
    )
)

# pet: sex, health, medications, handling, handling notes, groom, groom notes, emergency contact
INTAKES = {
    "sj_bella": (
        "Female, spayed",
        ["Skin allergies"],
        "Apoquel once a day in spring and summer. Her skin reacts to oatmeal shampoo.",
        ["Nervous with dryers", "Dislikes nail trims"],
        "Towel-dry her first and keep the dryer on low. She settles once I'm out of sight.",
        "Short all over (puppy cut)",
        "Rounded teddy bear face, ears left long.",
        ("Luc Tremblay", "+12505550194"),
    ),
    "sj_mochi": (
        "Female, spayed",
        ["None"],
        None,
        ["Easy to handle", "Food motivated"],
        "She's still a puppy and wriggles on the table; small treats help.",
        "Short all over (puppy cut)",
        "Keep the topknot long enough for a clip.",
        ("Minh Nguyen", "+12505550195"),
    ),
    "sj_zeus": (
        "Male, neutered",
        ["Arthritis or joint pain"],
        "A joint supplement with breakfast. No known allergies.",
        ["Sensitive paws", "Food motivated"],
        "His back legs are stiff. Please use the ramp rather than lifting him onto the table.",
        "Bath and brush only",
        None,
        ("Ada Okafor", "+12505550196"),
    ),
    "sj_kobe": (
        "Male, neutered",
        ["Breathing difficulty", "Skin allergies"],
        "Medicated wipes for his face folds. Avoid scented products.",
        ["May nip when handled"],
        "Keep the room cool and give him breaks if he pants hard. He grumbles at nail trims "
        "but settles with a lick mat.",
        "Bath and brush only",
        "Clean and dry the face folds well.",
        ("Tunde Adeyemi", "+12505550197"),
    ),
}
