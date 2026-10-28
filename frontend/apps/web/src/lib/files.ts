export function saveFile(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    // revoked on a later tick, since some browsers start the download after click returns
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 0);
}
