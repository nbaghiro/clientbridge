import { Icon } from "../art/Icon";
import { BRANDS, brandStyle } from "../content/brands";
import { shop } from "../content/demo";

export function ShopPhone() {
    const brand = BRANDS["pet-grooming"];
    return (
        <div className="mock phone shop-phone" style={brandStyle(brand)} aria-hidden="true">
            <div className="phone-scr">
                <div className="phone-bar">
                    <i />
                </div>
                <div className="phone-body gap-2.5">
                    <img
                        src={brand.lockup}
                        alt=""
                        width={Math.round(28 * brand.aspect)}
                        height={28}
                        className="self-start"
                    />
                    <div className="text-[17px] font-semibold">{shop.title}</div>
                    {shop.items.map((item) => (
                        <div key={item.name} className="shop-item">
                            <img src={item.image} alt="" width={44} height={44} loading="lazy" />
                            <div className="min-w-0">
                                <div className="text-[13px] leading-tight font-medium">
                                    {item.name}
                                </div>
                                <div className="xs muted">{item.detail}</div>
                                <div className="mt-1 flex items-center justify-between">
                                    <span className="mono text-[13px]">{item.price}</span>
                                    <span className="shop-qty">
                                        <span>{shop.minus}</span>
                                        <span className="mono">{item.qty}</span>
                                        <Icon name="plus" className="h-3 w-3" />
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                    <div className="mt-auto flex justify-between text-[13px]">
                        <span className="muted">{shop.subtotalLabel}</span>
                        <span className="mono font-semibold">{shop.subtotal}</span>
                    </div>
                    <div className="xs muted">{shop.pickup}</div>
                    <div className="fullbtn mt-0">{shop.pay}</div>
                </div>
            </div>
        </div>
    );
}
