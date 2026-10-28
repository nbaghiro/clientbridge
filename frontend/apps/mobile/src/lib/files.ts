import { File, Paths } from "expo-file-system";
import { shareAsync } from "expo-sharing";

export async function shareFile(
    content: string | Uint8Array,
    filename: string,
    mimeType: string,
): Promise<void> {
    const file = new File(Paths.cache, filename);
    file.write(content);
    await shareAsync(file.uri, { mimeType, dialogTitle: filename });
}
