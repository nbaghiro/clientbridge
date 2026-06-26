export function Placeholder({ title }: { title: string }) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
            <p className="text-sm text-muted">Coming soon.</p>
        </div>
    );
}
