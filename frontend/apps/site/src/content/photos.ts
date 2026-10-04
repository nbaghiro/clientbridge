/** Stock photos. Sources are in assets/photos/; scripts/images.ts writes the sizes below to /img/. */
export const PHOTO_WIDTHS = [480, 960, 1600] as const;

export interface PhotoInfo {
    width: number;
    height: number;
    subject: string;
    photographer: string;
    source: string;
}

const pexels = (
    width: number,
    height: number,
    subject: string,
    photographer: string,
    slug: string,
): PhotoInfo => ({
    width,
    height,
    subject,
    photographer,
    source: `https://www.pexels.com/photo/${slug}/`,
});

export const PHOTOS = {
    grooming: pexels(
        1600,
        1068,
        "Groomer trimming a Shih Tzu on a grooming table, a second dog waiting behind",
        "Goochie Poochie Grooming",
        "dog-groomer-at-work-19145893",
    ),
    "grooming-2": pexels(
        1600,
        1068,
        "Close-up of a Cocker Spaniel being brushed by a groomer's hands",
        "Goochie Poochie Grooming",
        "groomer-brushing-a-dog-19145879",
    ),
    salon: pexels(
        1600,
        1066,
        "Hairdresser's hands trimming a client's hair by a sunlit window",
        "Doğan Alpaslan Demir",
        "professional-haircut-session-in-sunlit-salon-29555480",
    ),
    "salon-2": pexels(
        1600,
        1066,
        "Stylist with a client in a hair salon, mirrors and styling chairs behind",
        "cottonbro studio",
        "woman-getting-a-haircut-3992875",
    ),
    fitness: pexels(
        1600,
        900,
        "Personal trainer reviewing a plan on a tablet with a client in a small gym",
        "Vitaly Gariev",
        "personal-trainer-consulting-with-client-at-gym-39219660",
    ),
    cleaning: pexels(
        1600,
        1066,
        "Woman wiping a white counter with a cloth in a bright home",
        "RDNE Stock project",
        "a-woman-cleaning-a-white-table-using-an-orange-towel-5591651",
    ),
    "cleaning-2": pexels(
        1600,
        900,
        "Woman in rubber gloves cleaning a table in a home with plants",
        "Vitaly Gariev",
        "woman-cleaning-indoors-with-headphones-and-plants-36715260",
    ),
    tutoring: pexels(
        1600,
        1069,
        "Teacher guiding a girl at a keyboard during a one-to-one music lesson",
        "Boris Pavlikovsky",
        "teacher-watching-her-student-playing-piano-7714182",
    ),
    "tutoring-2": pexels(
        1600,
        1066,
        "Music teacher seated beside a student playing a keyboard in a living room",
        "Boris Pavlikovsky",
        "woman-watching-the-girl-playing-piano-7714141",
    ),
    wellness: pexels(
        1600,
        1066,
        "Two therapists giving massages to clients in a treatment room",
        "Halosa Sapa",
        "masseuses-massaging-lying-clients-18120174",
    ),
    "wellness-2": pexels(
        1600,
        1000,
        "Therapist working on a client's back and shoulder by a studio window",
        "KoolShooters",
        "a-woman-having-a-massage-6628584",
    ),
    photography: pexels(
        1600,
        900,
        "Photographer checking his camera in a daylight studio with a softbox",
        "Vitaly Gariev",
        "professional-photographer-in-a-studio-setting-36697538",
    ),
    "photography-2": pexels(
        1600,
        900,
        "Photographer shooting a portrait of a seated client in a daylight studio",
        "Vitaly Gariev",
        "professional-photographer-taking-portrait-indoors-36697244",
    ),
    trades: pexels(
        1600,
        1068,
        "Tradesperson in a paint-spattered apron preparing a window frame on trestles",
        "Ksenia Chernaya",
        "crop-man-near-painted-window-5691501",
    ),
    "trades-2": pexels(
        1600,
        1068,
        "Tradesperson fitting a window frame with a cordless drill",
        "Ksenia Chernaya",
        "handyman-installing-window-frame-with-drill-in-house-5691544",
    ),
} as const satisfies Record<string, PhotoInfo>;

export type PhotoName = keyof typeof PHOTOS;

export const photoUrl = (name: PhotoName, width: number, ext: string): string =>
    `/img/${name}-${String(width)}.${ext}`;
