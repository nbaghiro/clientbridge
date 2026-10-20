import { useState } from "react";

import type { ApiLike } from "../api";
import { dateKey, formatDate, readDate } from "../datetime";
import { formatParts, parseNumber } from "../format";
import { useAsyncAction, useBusinessQuery as useQuery } from "../hooks";
import { strings } from "../strings";
import type { ChoiceOption, Intent } from "../ui";
import { type Photo, useFileLinks } from "./files";

const s = strings.subjects;

export type SubjectKind = "pet" | "student" | "property" | "site";

/** A business's answer to what it books: one of the kinds, or "none" for only the client. */
export type SubjectChoice = SubjectKind | "none";

const KINDS: readonly SubjectKind[] = ["pet", "student", "property", "site"];

export function asSubjectKind(value: string | null | undefined): SubjectKind | null {
    return KINDS.find((k) => k === value) ?? null;
}

/** The catalog's select value for a kind; "none" picks the wording for a business without one. */
export function kindWord(kind: SubjectKind | null): SubjectChoice {
    return kind ?? "none";
}

export function kindOf(choice: SubjectChoice): SubjectKind | null {
    return choice === "none" ? null : choice;
}

/** The answers to what clients book for, each with the trades it suits. */
export function subjectChoices(): ChoiceOption<SubjectChoice>[] {
    return (["pet", "student", "property", "site", "none"] as const).map((key) => ({
        key,
        label: s.choice(key),
        hint: s.choiceHint(key),
    }));
}

export const SUBJECT_COUNT_SQL = "SELECT COUNT(*) AS n FROM subjects WHERE deleted_at IS NULL";

export const SUBJECT_KIND_SQL = "SELECT subject FROM businesses LIMIT 1";

/** What this business books besides the client; null when it books only the client. */
export function useSubjectKind(): SubjectKind | null {
    return asSubjectKind(useQuery<{ subject: string | null }>(SUBJECT_KIND_SQL).data[0]?.subject);
}

export const CLIENT_SUBJECTS_SQL = `
SELECT id, client_id, name, attributes, created_at FROM subjects
WHERE client_id = ? AND deleted_at IS NULL ORDER BY created_at, name`;

export interface SubjectDbRow {
    id: string;
    client_id: string;
    name: string;
    attributes: string | null;
    created_at: string;
}

export interface SubjectRow {
    id: string;
    clientId: string;
    name: string;
    attributes: Record<string, unknown>;
}

export function parseAttributes(raw: string | null): Record<string, unknown> {
    if (raw === null || raw === "") return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

export function toSubject(r: SubjectDbRow): SubjectRow {
    return {
        id: r.id,
        clientId: r.client_id,
        name: r.name,
        attributes: parseAttributes(r.attributes),
    };
}

const text = (v: unknown): string =>
    typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

const TEMPERAMENTS = ["calm", "friendly", "energetic", "anxious", "reactive"];
const NERVOUS = new Set(["anxious", "reactive", "skittish"]);

/** A stored temperament (an English word) shown through the catalog; unknown values as stored. */
function temperamentLabel(value: string): string {
    return s.fields.pet.temperaments[value] ?? value;
}

/** A pet's temperament and whether staff should take care; null for other kinds or when unset. */
export function subjectTemperament(
    kind: SubjectKind | null,
    attributes: Record<string, unknown>,
): { label: string; nervous: boolean } | null {
    const value = text(attributes.temperament);
    if (kind !== "pet" || value === "") return null;
    return { label: temperamentLabel(value), nervous: NERVOUS.has(value) };
}

type SubjectFieldType = "text" | "number" | "date" | "choice" | "longtext";

export interface SubjectField {
    key: string;
    label: string;
    type: SubjectFieldType;
    options?: readonly { key: string; label: string }[] | undefined;
    unit?: string | undefined;
    placeholder?: string | undefined;
    half?: boolean | undefined;
}

const option = (key: string, label: () => string): { key: string; label: string } => ({
    key,
    get label() {
        return label();
    },
});

const BREED: SubjectField = {
    key: "breed",
    get label() {
        return s.fields.pet.breed;
    },
    type: "text",
    half: true,
};

const GRADE: SubjectField = {
    key: "grade",
    get label() {
        return s.fields.student.grade;
    },
    type: "text",
    get placeholder() {
        return s.fields.student.gradePlaceholder;
    },
    half: true,
};

const ADDRESS: SubjectField = {
    key: "address",
    get label() {
        return s.fields.property.address;
    },
    type: "text",
};

const PET_FIELDS: readonly SubjectField[] = [
    {
        key: "species",
        get label() {
            return s.fields.pet.species;
        },
        type: "choice",
        options: [
            option("dog", () => s.fields.pet.dog),
            option("cat", () => s.fields.pet.cat),
            option("other", () => s.fields.pet.other),
        ],
    },
    BREED,
    {
        key: "weight_kg",
        get label() {
            return s.fields.pet.weight;
        },
        type: "number",
        get unit() {
            return s.fields.pet.weightUnit;
        },
        half: true,
    },
    {
        key: "birthday",
        get label() {
            return s.fields.birthday;
        },
        type: "date",
        half: true,
    },
    {
        key: "sex",
        get label() {
            return s.fields.pet.sex;
        },
        type: "choice",
        options: [
            option("female", () => s.fields.pet.female),
            option("male", () => s.fields.pet.male),
        ],
        half: true,
    },
    {
        key: "temperament",
        get label() {
            return s.fields.pet.temperament;
        },
        type: "choice",
        options: TEMPERAMENTS.map((t) => option(t, () => temperamentLabel(t))),
    },
    {
        key: "coat",
        get label() {
            return s.fields.pet.coat;
        },
        type: "text",
        half: true,
    },
    {
        key: "allergies",
        get label() {
            return s.fields.allergies;
        },
        type: "text",
        get placeholder() {
            return s.fields.pet.allergiesPlaceholder;
        },
        half: true,
    },
    {
        key: "vet",
        get label() {
            return s.fields.pet.vet;
        },
        type: "text",
        half: true,
    },
    {
        key: "rabies_until",
        get label() {
            return s.fields.pet.rabies;
        },
        type: "date",
        half: true,
    },
    {
        key: "style",
        get label() {
            return s.fields.pet.style;
        },
        type: "longtext",
        get placeholder() {
            return s.fields.pet.stylePlaceholder;
        },
    },
];

const STUDENT_FIELDS: readonly SubjectField[] = [
    GRADE,
    {
        key: "birthday",
        get label() {
            return s.fields.birthday;
        },
        type: "date",
        half: true,
    },
    {
        key: "school",
        get label() {
            return s.fields.student.school;
        },
        type: "text",
        half: true,
    },
    {
        key: "allergies",
        get label() {
            return s.fields.allergies;
        },
        type: "text",
        half: true,
    },
];

const PROPERTY_FIELDS: readonly SubjectField[] = [
    ADDRESS,
    {
        key: "rooms",
        get label() {
            return s.fields.property.rooms;
        },
        type: "number",
        half: true,
    },
    {
        key: "pets",
        get label() {
            return s.fields.property.pets;
        },
        type: "text",
        get placeholder() {
            return s.fields.property.petsPlaceholder;
        },
        half: true,
    },
    {
        key: "access",
        get label() {
            return s.fields.property.access;
        },
        type: "longtext",
        get placeholder() {
            return s.fields.property.accessPlaceholder;
        },
    },
];

const BUILDINGS = ["house", "townhouse", "apartment", "retail", "office", "warehouse"] as const;

const SITE_FIELDS: readonly SubjectField[] = [
    ADDRESS,
    {
        key: "building",
        get label() {
            return s.fields.site.building;
        },
        type: "choice",
        options: BUILDINGS.map((b) => option(b, () => s.fields.site.buildings(b))),
    },
    {
        key: "internet",
        get label() {
            return s.fields.site.internet;
        },
        type: "text",
        get placeholder() {
            return s.fields.site.internetPlaceholder;
        },
        half: true,
    },
    {
        key: "recorder_location",
        get label() {
            return s.fields.site.recorder;
        },
        type: "text",
        get placeholder() {
            return s.fields.site.recorderPlaceholder;
        },
        half: true,
    },
    {
        key: "pets",
        get label() {
            return s.fields.site.pets;
        },
        type: "text",
        get placeholder() {
            return s.fields.site.petsPlaceholder;
        },
    },
    {
        key: "access",
        get label() {
            return s.fields.property.access;
        },
        type: "longtext",
        get placeholder() {
            return s.fields.site.accessPlaceholder;
        },
    },
];

// One schema per kind; the form and the card render from it, so a kind needs no screens of its own.
const SUBJECT_FIELDS: Record<SubjectKind, readonly SubjectField[]> = {
    pet: PET_FIELDS,
    student: STUDENT_FIELDS,
    property: PROPERTY_FIELDS,
    site: SITE_FIELDS,
};

const LEAD_FIELD: Record<SubjectKind, SubjectField> = {
    pet: BREED,
    student: GRADE,
    property: ADDRESS,
    site: ADDRESS,
};

/** The one detail asked for beside the name when a new client brings their first subject. */
export function leadField(kind: SubjectKind): SubjectField {
    return LEAD_FIELD[kind];
}

const EQUIPMENT_KEYS = ["model", "serial", "location", "installed_on", "warranty_until"] as const;

type EquipmentKey = (typeof EQUIPMENT_KEYS)[number];

type EquipmentDraft = Record<EquipmentKey, string>;

interface EquipmentField {
    key: EquipmentKey;
    label: string;
    type: "text" | "date";
    placeholder?: string | undefined;
}

/** The fields of one installed device, in the order a site's equipment form asks for them. */
export const EQUIPMENT_FIELDS: readonly EquipmentField[] = [
    {
        key: "model",
        get label() {
            return s.equipment.model;
        },
        type: "text",
        get placeholder() {
            return s.equipment.modelPlaceholder;
        },
    },
    {
        key: "location",
        get label() {
            return s.equipment.location;
        },
        type: "text",
        get placeholder() {
            return s.equipment.locationPlaceholder;
        },
    },
    {
        key: "serial",
        get label() {
            return s.equipment.serial;
        },
        type: "text",
    },
    {
        key: "installed_on",
        get label() {
            return s.equipment.installedOn;
        },
        type: "date",
    },
    {
        key: "warranty_until",
        get label() {
            return s.equipment.warrantyUntil;
        },
        type: "date",
    },
];

/** The most devices one site holds, matching the API's limit. */
export const EQUIPMENT_MAX = 100;

const EQUIPMENT_LENGTH: Record<EquipmentKey, number> = {
    model: 80,
    serial: 80,
    location: 80,
    installed_on: 10,
    warranty_until: 10,
};

const DATE_KEYS: ReadonlySet<EquipmentKey> = new Set(["installed_on", "warranty_until"]);

const blankEquipment = (): EquipmentDraft => ({
    model: "",
    serial: "",
    location: "",
    installed_on: "",
    warranty_until: "",
});

/** A site's stored equipment list as drafts; entries that are not objects are dropped. */
function storedEquipment(attributes: Record<string, unknown>): EquipmentDraft[] {
    const list = attributes.equipment;
    if (!Array.isArray(list)) return [];
    return list
        .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
        .map((e) => ({
            model: text(e.model),
            serial: text(e.serial),
            location: text(e.location),
            installed_on: text(e.installed_on),
            warranty_until: text(e.warranty_until),
        }));
}

export interface EquipmentLine {
    key: string;
    model: string;
    detail: string;
    warranty: string | null;
    intent: Intent;
}

const WARRANTY_SOON_DAYS = 60;

/** One line per installed device, with its warranty and whether it has ended or ends soon. */
export function equipmentLines(
    attributes: Record<string, unknown>,
    zone: string,
    now: Date = new Date(),
): EquipmentLine[] {
    return storedEquipment(attributes).map((e, i) => {
        const installed = e.installed_on === "" ? null : readDate(e.installed_on, zone);
        const until = e.warranty_until === "" ? null : readDate(e.warranty_until, zone);
        const days = until === null ? null : (until.getTime() - now.getTime()) / 86_400_000;
        return {
            key: `${String(i)}-${e.model}`,
            model: e.model,
            detail: formatParts([
                e.location,
                e.serial === "" ? "" : s.equipment.serialShort(e.serial),
                installed === null ? "" : s.equipment.installed(formatDate(installed, zone)),
            ]),
            warranty:
                until === null || days === null
                    ? null
                    : days < 0
                      ? s.equipment.warrantyEnded(formatDate(until, zone))
                      : s.equipment.warrantyEnds(formatDate(until, zone)),
            intent:
                days === null
                    ? "neutral"
                    : days < 0
                      ? "danger"
                      : days < WARRANTY_SOON_DAYS
                        ? "warning"
                        : "success",
        };
    });
}

function ageYears(birthday: string, now: Date, zone: string): number | null {
    const b = readDate(birthday, zone);
    if (Number.isNaN(b.getTime())) return null;
    const born = dateKey(b, zone);
    const today = dateKey(now, zone);
    const years = Number(today.slice(0, 4)) - Number(born.slice(0, 4));
    return today.slice(5) < born.slice(5) ? years - 1 : years;
}

/** One line about a subject: a pet's breed, age and weight, a student's grade and school, an address. */
export function subjectSummary(
    kind: SubjectKind | null,
    attributes: Record<string, unknown>,
    zone: string,
    now: Date = new Date(),
): string {
    const birthday = text(attributes.birthday);
    const age = birthday === "" ? null : ageYears(birthday, now, zone);
    const ageLabel = age === null ? "" : s.age(age);
    if (kind === "pet") {
        const weight = Number(text(attributes.weight_kg));
        return formatParts([text(attributes.breed), ageLabel, weight > 0 ? s.weight(weight) : ""]);
    }
    if (kind === "student")
        return formatParts([text(attributes.grade), text(attributes.school), ageLabel]);
    if (kind === "property") {
        const rooms = Number(text(attributes.rooms));
        return formatParts([text(attributes.address), rooms > 0 ? s.rooms(rooms) : ""]);
    }
    if (kind === "site") {
        const building = text(attributes.building);
        const devices = storedEquipment(attributes).length;
        return formatParts([
            text(attributes.address),
            building === "" ? "" : s.fields.site.buildings(building),
            devices > 0 ? s.devices(devices) : "",
        ]);
    }
    return "";
}

export interface SubjectAlert {
    key: string;
    label: string;
    intent: Intent;
}

/** What to watch for: allergies for pets and students, a pet's temperament and rabies vaccine. */
export function subjectAlerts(
    kind: SubjectKind | null,
    attributes: Record<string, unknown>,
    now: Date,
    zone: string,
): SubjectAlert[] {
    const out: SubjectAlert[] = [];
    const temperament = subjectTemperament(kind, attributes);
    if (temperament?.nervous === true)
        out.push({
            key: "temp",
            label: s.temperamentAlert(temperament.label),
            intent: "warning",
        });
    const allergies = text(attributes.allergies);
    if (allergies !== "" && (kind === "pet" || kind === "student"))
        out.push({ key: "allergy", label: s.allergy(allergies), intent: "danger" });
    const rabies = text(attributes.rabies_until);
    if (kind === "pet" && rabies !== "") {
        const days = (readDate(rabies, zone).getTime() - now.getTime()) / 86_400_000;
        if (days < 0) out.push({ key: "rabies", label: s.rabiesExpired, intent: "danger" });
        else if (days < 45)
            out.push({
                key: "rabies",
                label: s.rabiesSoon(formatDate(readDate(rabies, zone), zone)),
                intent: "warning",
            });
    }
    return out;
}

export interface SubjectForm {
    mode: "add" | "edit";
    kind: SubjectKind | null;
    fields: readonly SubjectField[];
    name: string;
    setName: (v: string) => void;
    values: Record<string, string>;
    setValue: (key: string, v: string) => void;
    /** A site's installed devices; null for kinds that keep no equipment list. */
    equipment: EquipmentDraft[] | null;
    addEquipment: () => void;
    setEquipment: (index: number, key: EquipmentKey, v: string) => void;
    removeEquipment: (index: number) => void;
    errors: Record<string, string>;
    busy: boolean;
    error: string | null;
    submit: () => void;
    remove: () => void;
}

function storedValues(
    fields: readonly SubjectField[],
    subject: SubjectRow | null,
): Record<string, string> {
    if (subject === null) return fields.some((f) => f.key === "species") ? { species: "dog" } : {};
    return Object.fromEntries(fields.map((f) => [f.key, text(subject.attributes[f.key])]));
}

/** Add or edit one subject from its kind's fields; details the kind doesn't show are kept. */
export function useSubjectForm(
    api: ApiLike,
    clientId: string,
    subject: SubjectRow | null,
    onDone: () => void,
): SubjectForm {
    const kind = useSubjectKind();
    const word = kindWord(kind);
    const fields = kind === null ? [] : SUBJECT_FIELDS[kind];
    const [name, setNameRaw] = useState(subject?.name ?? "");
    const [edits, setEdits] = useState<Record<string, string>>({});
    const [devices, setDevices] = useState<EquipmentDraft[] | null>(null);
    const equipment =
        kind === "site" ? (devices ?? storedEquipment(subject?.attributes ?? {})) : null;
    // edits sit over the stored values, so a kind that syncs after the first render still fills in
    const values = { ...storedValues(fields, subject), ...edits };
    const [tried, setTried] = useState(false);
    const { busy, error, setError, run } = useAsyncAction();

    const check = (): Record<string, string> => {
        const e: Record<string, string> = {};
        if (name.trim() === "") e.name = s.nameRequired(word);
        for (const f of fields) {
            const v = values[f.key] ?? "";
            if (v === "") continue;
            if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) e[f.key] = s.dateInvalid;
            if (f.key === "weight_kg") {
                const kg = parseNumber(v) ?? NaN;
                if (!(kg > 0 && kg < 200)) e[f.key] = s.fields.pet.weightInvalid;
            }
            if (f.key === "rooms") {
                const rooms = parseNumber(v) ?? NaN;
                if (!(Number.isInteger(rooms) && rooms >= 0 && rooms <= 100))
                    e[f.key] = s.fields.property.roomsInvalid;
            }
        }
        (equipment ?? []).forEach((d, i) => {
            if (EQUIPMENT_KEYS.every((k) => d[k].trim() === "")) return;
            if (d.model.trim() === "")
                e[`equipment.${String(i)}.model`] = s.equipment.modelRequired;
            for (const k of EQUIPMENT_KEYS) {
                const v = d[k].trim();
                if (v.length > EQUIPMENT_LENGTH[k])
                    e[`equipment.${String(i)}.${k}`] = s.equipment.tooLong(EQUIPMENT_LENGTH[k]);
                else if (DATE_KEYS.has(k) && v !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(v))
                    e[`equipment.${String(i)}.${k}`] = s.dateInvalid;
            }
        });
        return e;
    };

    const submit = (): void => {
        setTried(true);
        if (Object.keys(check()).length > 0) return;
        const known = new Set(fields.map((f) => f.key));
        if (equipment !== null) known.add("equipment");
        const kept = Object.fromEntries(
            Object.entries(subject?.attributes ?? {}).filter(([k]) => !known.has(k)),
        );
        const typed = Object.fromEntries(
            fields
                .map((f) => [f, (values[f.key] ?? "").trim()] as const)
                .filter(([, v]) => v !== "")
                .map(([f, v]) => [f.key, f.type === "number" ? parseNumber(v) : v]),
        );
        const devicesTyped = (equipment ?? [])
            .map((d) =>
                Object.fromEntries(
                    EQUIPMENT_KEYS.map((k) => [k, d[k].trim()] as const).filter(
                        ([, v]) => v !== "",
                    ),
                ),
            )
            .filter((d) => Object.keys(d).length > 0);
        const attributes = {
            ...kept,
            ...typed,
            ...(devicesTyped.length > 0 ? { equipment: devicesTyped } : {}),
        };
        run(
            async () => {
                if (subject === null) {
                    await api.post("/v1/subjects", {
                        client_id: clientId,
                        name: name.trim(),
                        attributes,
                    });
                } else {
                    await api.patch(`/v1/subjects/${subject.id}`, {
                        name: name.trim(),
                        attributes,
                    });
                }
                onDone();
            },
            { errorMessage: s.saveError(word) },
        );
    };

    return {
        mode: subject === null ? "add" : "edit",
        kind,
        fields,
        name,
        setName: (v) => {
            setNameRaw(v);
            setError(null);
        },
        values,
        setValue: (key, v) => {
            setEdits((x) => ({ ...x, [key]: v }));
            setError(null);
        },
        equipment,
        addEquipment: () => {
            if (equipment === null || equipment.length >= EQUIPMENT_MAX) return;
            setDevices([...equipment, blankEquipment()]);
        },
        setEquipment: (index, key, v) => {
            if (equipment === null) return;
            setDevices(equipment.map((d, i) => (i === index ? { ...d, [key]: v } : d)));
            setError(null);
        },
        removeEquipment: (index) => {
            if (equipment === null) return;
            setDevices(equipment.filter((_, i) => i !== index));
        },
        errors: tried ? check() : {},
        busy,
        error,
        submit,
        remove: () => {
            if (subject === null) return;
            run(
                async () => {
                    await api.delete(`/v1/subjects/${subject.id}`);
                    onDone();
                },
                { errorMessage: s.removeError(word) },
            );
        },
    };
}

const SUBJECT_PHOTO_LIMIT = 12;

export const SUBJECT_PHOTOS_SQL = `
SELECT f.id FROM files f JOIN bookings b ON b.id = f.parent_id
WHERE f.parent_type = 'booking' AND b.subject_id = ? AND b.deleted_at IS NULL
  AND f.uploaded_at IS NOT NULL
ORDER BY f.created_at DESC, f.id LIMIT ${String(SUBJECT_PHOTO_LIMIT)}`;

/** The latest job photos taken on a subject's visits, newest first. */
export function useSubjectPhotos(api: ApiLike, subjectId: string): Photo[] {
    const rows = useQuery<{ id: string }>(SUBJECT_PHOTOS_SQL, [subjectId]).data;
    const links = useFileLinks(
        api,
        rows.map((r) => r.id),
    );
    return rows.map((r) => ({ id: r.id, src: links[r.id] ?? null }));
}
