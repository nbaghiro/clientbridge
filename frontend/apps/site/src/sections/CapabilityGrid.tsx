import { LineIcon, type LineIconName } from "../art/LineIcon";

export function CapabilityGrid({
    items,
    className = "more",
}: {
    items: readonly { icon: LineIconName; title: string; body: string }[];
    className?: string;
}) {
    return (
        <div className={className}>
            {items.map((item) => (
                <div key={item.title}>
                    <LineIcon name={item.icon} />
                    <h3 className="h3">{item.title}</h3>
                    <p>{item.body}</p>
                </div>
            ))}
        </div>
    );
}
