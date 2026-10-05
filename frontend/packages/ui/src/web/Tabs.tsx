export function Tabs<K extends string>({
    items,
    active,
    onSelect,
}: {
    items: { key: K; label: string }[];
    active: K;
    onSelect: (key: K) => void;
}) {
    return (
        <nav className="flex gap-6 text-sm font-medium">
            {items.map((item) => (
                <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                        onSelect(item.key);
                    }}
                    className={`-mb-px border-b-2 pb-3 pt-1 transition ${
                        item.key === active
                            ? "border-accent text-ink"
                            : "border-transparent text-muted hover:text-ink-soft"
                    }`}
                >
                    {item.label}
                </button>
            ))}
        </nav>
    );
}
