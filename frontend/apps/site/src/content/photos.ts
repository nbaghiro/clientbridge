/** Stock photos. Sources are in assets/photos/; scripts/images.ts writes the sizes below to /photos/. */
export const PHOTO_WIDTHS = [480, 960, 1600] as const;

interface PhotoInfo {
    width: number;
    height: number;
    photographer: string;
    source: string;
}

const pexels = (width: number, height: number, photographer: string, slug: string): PhotoInfo => ({
    width,
    height,
    photographer,
    source: `https://www.pexels.com/photo/${slug}/`,
});

export const PHOTOS = {
    grooming: pexels(1600, 1068, "Goochie Poochie Grooming", "dog-groomer-at-work-19145893"),
    "grooming-2": pexels(1600, 1068, "Goochie Poochie Grooming", "groomer-brushing-a-dog-19145879"),
    salon: pexels(
        1600,
        1066,
        "Doğan Alpaslan Demir",
        "professional-haircut-session-in-sunlit-salon-29555480",
    ),
    "salon-2": pexels(1600, 1066, "cottonbro studio", "woman-getting-a-haircut-3992875"),
    fitness: pexels(
        1600,
        900,
        "Vitaly Gariev",
        "personal-trainer-consulting-with-client-at-gym-39219660",
    ),
    cleaning: pexels(
        1600,
        1066,
        "RDNE Stock project",
        "a-woman-cleaning-a-white-table-using-an-orange-towel-5591651",
    ),
    "cleaning-2": pexels(
        1600,
        900,
        "Vitaly Gariev",
        "woman-cleaning-indoors-with-headphones-and-plants-36715260",
    ),
    tutoring: pexels(
        1600,
        1069,
        "Boris Pavlikovsky",
        "teacher-watching-her-student-playing-piano-7714182",
    ),
    "tutoring-2": pexels(
        1600,
        1066,
        "Boris Pavlikovsky",
        "woman-watching-the-girl-playing-piano-7714141",
    ),
    wellness: pexels(1600, 1066, "Halosa Sapa", "masseuses-massaging-lying-clients-18120174"),
    "wellness-2": pexels(1600, 1000, "KoolShooters", "a-woman-having-a-massage-6628584"),
    photography: pexels(
        1600,
        900,
        "Vitaly Gariev",
        "professional-photographer-in-a-studio-setting-36697538",
    ),
    "photography-2": pexels(
        1600,
        900,
        "Vitaly Gariev",
        "professional-photographer-taking-portrait-indoors-36697244",
    ),
    trades: pexels(1600, 1068, "Ksenia Chernaya", "crop-man-near-painted-window-5691501"),
    "trades-2": pexels(
        1600,
        1068,
        "Ksenia Chernaya",
        "handyman-installing-window-frame-with-drill-in-house-5691544",
    ),
} as const satisfies Record<string, PhotoInfo>;

export type PhotoName = keyof typeof PHOTOS;

export const photoUrl = (name: PhotoName, width: number, ext: string): string =>
    `/photos/${name}-${String(width)}.${ext}`;
