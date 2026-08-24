import type { CSSProperties } from "react";
import type { MarketingProRect } from "@/lib/marketing-pro";
import type { MarketingProPreviewModel } from "@/lib/marketing-pro-compositor";

type MarketingProPreviewProps = {
  model: MarketingProPreviewModel;
};

function rectStyle(rect: MarketingProRect): CSSProperties {
  return {
    position: "absolute",
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };
}

function fitTextStyle(): CSSProperties {
  return {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}

export function MarketingProPreview({ model }: MarketingProPreviewProps) {
  const { composition, format, profile } = model;
  const overlay = composition.commercialOverlay;
  const productLayer = composition.protectedProductLayer;
  const isDark = profile.foreground === "#ffffff";
  const productZoneStyle: CSSProperties = {
    ...rectStyle(productLayer.placement),
    background: profile.surfaceCss,
    border: isDark ? "1px solid rgba(255,255,255,.18)" : "1px solid rgba(37,45,58,.1)",
    borderRadius: "5%",
    padding: "4%",
    zIndex: 2,
  };
  const storeZone = composition.artDirection.textSafeZones.find((zone) => zone.id === "store")?.rect ?? format.safeZones.store;
  const productNameZone = format.safeZones.productName;
  const priceZone = format.safeZones.price;
  const benefitsZone = format.safeZones.benefits;
  const ctaZone = format.safeZones.cta;

  return (
    <article
      className="relative mx-auto aspect-[4/5] w-full max-w-[540px] overflow-hidden rounded-[28px] border border-black/10 shadow-xl"
      style={{
        background: profile.backgroundCss,
        color: profile.foreground,
        containerType: "inline-size",
      }}
      aria-label={`Prévia de estilo ${profile.label}`}
      data-testid="marketing-pro-preview"
      data-pro-format="4:5"
      data-pro-style={profile.style}
    >
      {profile.decorations.map((decoration) => (
        <span
          key={decoration.id}
          aria-hidden="true"
          style={{
            ...rectStyle(decoration.rect),
            background: decoration.fill,
            borderRadius: decoration.borderRadius,
            opacity: decoration.opacity,
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
      ))}

      <div style={productZoneStyle} data-protected-product="true" data-product-fit="contain">
        <img
          src={productLayer.sourceImage || undefined}
          alt={overlay.productName}
          className="h-full w-full object-contain"
          style={{ objectFit: "contain", objectPosition: "center", maxWidth: "100%", maxHeight: "100%" }}
        />
      </div>

      <div
        style={{ ...rectStyle(storeZone), zIndex: 3 }}
        className="flex min-w-0 items-center gap-[2.5%]"
        data-pro-zone="store"
      >
        {overlay.storeLogoUrl ? (
          <img src={overlay.storeLogoUrl} alt="" className="h-[70%] w-auto rounded-full object-contain" />
        ) : (
          <span className="flex h-[62%] aspect-square items-center justify-center rounded-full text-[clamp(10px,2.2cqw,22px)] font-black text-white" style={{ background: profile.accent }}>
            {overlay.storeName.slice(0, 1).toUpperCase() || "R"}
          </span>
        )}
        <span className="min-w-0 text-[clamp(12px,2.7cqw,28px)] font-black" style={fitTextStyle()}>
          {overlay.storeName}
        </span>
      </div>

      <div
        style={{ ...rectStyle(productNameZone), zIndex: 3 }}
        className="min-w-0"
        data-pro-zone="product-name"
      >
        <p className="text-[clamp(15px,4.2cqw,40px)] font-black leading-[1.05]" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {overlay.productName}
        </p>
        {(overlay.brand || overlay.volume) && (
          <p className="mt-[1.5%] text-[clamp(10px,2.2cqw,22px)] font-semibold opacity-75" style={fitTextStyle()}>
            {[overlay.brand, overlay.volume].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      <div style={{ ...rectStyle(priceZone), zIndex: 3 }} className="min-w-0" data-pro-zone="price">
        <p className="text-[clamp(19px,5cqw,48px)] font-black leading-none">{overlay.currentPriceText}</p>
        {overlay.previousPrice !== undefined && overlay.previousPrice > overlay.currentPrice && (
          <p className="mt-[2%] text-[clamp(9px,1.9cqw,18px)] font-semibold line-through opacity-65">
            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(overlay.previousPrice).replace(/\u00a0/g, " ")}
          </p>
        )}
      </div>

      <div style={{ ...rectStyle(benefitsZone), zIndex: 3 }} className="min-w-0" data-pro-zone="benefits">
        <p className="text-[clamp(9px,2cqw,19px)] font-semibold" style={fitTextStyle()}>
          {overlay.benefits.slice(0, 3).join(" · ") || (overlay.availability === "available" ? "Disponível" : "Indisponível")}
        </p>
      </div>

      <span
        style={{ ...rectStyle(ctaZone), zIndex: 3, background: profile.accent }}
        className="flex items-center justify-center rounded-full px-[3%] text-center text-[clamp(9px,2cqw,19px)] font-black text-white shadow-sm"
        data-pro-zone="cta"
      >
        {overlay.cta.label}
      </span>

      <span
        className="absolute bottom-[2.5%] left-[8%] text-[clamp(8px,1.7cqw,16px)] font-semibold opacity-65"
        aria-hidden="true"
      >
        Prévia de estilo · composição local
      </span>
    </article>
  );
}
