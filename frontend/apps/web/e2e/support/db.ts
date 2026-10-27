import postgres from "postgres";
import { runSetting } from "@clientbridge/config/e2e/run";

type Value = string | number | boolean | null | readonly string[];

function connect() {
    return postgres(runSetting("E2E_DATABASE_URL"), {
        max: 2,
        idle_timeout: 5,
        onnotice: () => undefined,
        // money and sequence columns are int8; the tests compare them as numbers
        types: {
            int8: {
                to: 20,
                from: [20],
                serialize: (value: number) => String(value),
                parse: (raw: string) => Number(raw),
            },
        },
        connection: {
            application_name: "e2e-observer",
            default_transaction_read_only: true,
            TimeZone: "UTC",
        },
    });
}

let connection: ReturnType<typeof connect> | undefined;

/** Rows from a read-only session on the run's database, as plain arrays of plain objects. */
export async function select<T extends object>(
    text: TemplateStringsArray,
    ...values: Value[]
): Promise<T[]> {
    connection ??= connect();
    const rows = await connection<T[]>(text, ...values);
    return [...rows];
}
