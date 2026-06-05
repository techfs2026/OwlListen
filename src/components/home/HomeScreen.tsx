import React from "react";
import { Badge } from "@/components/shared/Primitives";

export type AppMode = "home" | "annotate" | "listen" | "audiobook";

interface HomeScreenProps {
  onSelect: (mode: "annotate" | "listen" | "audiobook") => void;
}

export function HomeScreen({ onSelect }: HomeScreenProps) {
  return (
    <div style={s.root}>
      <div style={s.texture} />
      <div style={s.content}>
        <div style={s.logoWrap}>
          <div style={s.logoEyebrow}>a listening practice platform</div>
          <h1 style={s.logoTitle}>OwlListen</h1>
        </div>

        <div style={s.cards}>
          <ModeCard
            badge={<Badge color="blue">第一步 · 标注</Badge>}
            title="初次精听"
            desc="连续听，把没跟上的句子在波形上拖拽框选，选中即自动回环反复攻克；难句攒成错题包，导出带 Whisper 原文的 ZIP。"
            accentColor={"var(--color-brand)"}
            features={["拖拽框选断句", "选中即自动回环", "片段备注", "导出 ZIP 错题包"]}
            onClick={() => onSelect("annotate")}
          />
          <ModeCard
            badge={<Badge color="green">第二步 · 复习</Badge>}
            title="精听复习"
            desc="导入错题包，逐句反复听写，Diff 对照原文查漏补缺，没攻克的句子随手标记重听。"
            accentColor={"var(--color-success)"}
            features={["逐句听写", "原文 Diff 对照", "标记重听", "全键盘操作"]}
            onClick={() => onSelect("listen")}
          />
          <ModeCard
            badge={<Badge color="blue">日常 · 泛听</Badge>}
            title="听有声书"
            desc="打开 M4B 有声书，自动解析章节、变速播放、进度自动续读，用作精听之外的大量泛听输入。"
            accentColor="#F97316"
            features={["自动解析章节", "0.5×～1.75× 变速", "进度自动续读", "支持 M4B"]}
            onClick={() => onSelect("audiobook")}
          />
        </div>
      </div>
    </div>
  );
}

interface ModeCardProps {
  badge: React.ReactNode;
  title: string;
  desc: string;
  accentColor: string;
  features: string[];
  onClick: () => void;
}

function ModeCard({ badge, title, desc, accentColor, features, onClick }: ModeCardProps) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...s.card,
        borderColor: hovered ? accentColor + "66" : "var(--color-border-2)",
        boxShadow: hovered ? `0 8px 32px ${accentColor}18, var(--shadow-md)` : "var(--shadow-md)",
        transform: hovered ? "translateY(-2px)" : "none",
      }}
    >
      <div style={{ ...s.stripe, background: accentColor }} />
      <div style={s.cardInner}>
        <div style={{ marginBottom: 12 }}>{badge}</div>
        <h2 style={{ ...s.cardTitle, color: accentColor }}>{title}</h2>
        <p style={s.cardDesc}>{desc}</p>
        <ul style={s.featureList}>
          {features.map((f) => (
            <li key={f} style={s.featureItem}>
              <span style={{ ...s.featureDot, background: accentColor }} />
              {f}
            </li>
          ))}
        </ul>
        <div style={{ ...s.cardArrow, color: hovered ? accentColor : "var(--color-border-2)" }}>
          →
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    width: "100vw",
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--color-paper-2)",
    position: "relative",
    overflow: "hidden",
  },
  texture: {
    position: "absolute",
    inset: 0,
    backgroundImage: `
      linear-gradient(var(--color-border) 1px, transparent 1px),
      linear-gradient(90deg, var(--color-border) 1px, transparent 1px)
    `,
    backgroundSize: "40px 40px",
    opacity: 0.6,
    pointerEvents: "none",
  },
  content: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 40,
    animation: "fadeIn 0.4s ease both",
  },
  logoWrap: { textAlign: "center" },
  logoEyebrow: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--color-ink-3)",
    marginBottom: 10,
  },
  logoTitle: {
    fontFamily: "var(--font-serif)",
    fontSize: 46,
    fontWeight: 400,
    color: "var(--color-ink-1)",
    letterSpacing: "-0.5px",
    lineHeight: 1.15,
    marginBottom: 10,
  },
  logoSub: { fontSize: 15, color: "var(--color-ink-3)", fontWeight: 300 },
  // 三列网格
  cards: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 20,
    width: 1020,
  },
  card: {
    background: "var(--color-paper)",
    border: `1px solid var(--color-border-2)`,
    borderRadius: 16,
    cursor: "pointer",
    position: "relative",
    overflow: "hidden",
    transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s",
  },
  stripe: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  cardInner: { padding: "28px 26px 24px 32px", display: "flex", flexDirection: "column" as const },
  cardTitle: { fontFamily: "var(--font-sans)", fontSize: 18, fontWeight: 500, marginBottom: 10 },
  cardDesc: { fontSize: 13, color: "var(--color-ink-3)", lineHeight: 1.65, marginBottom: 16 },
  featureList: {
    listStyle: "none",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    marginBottom: 20,
  },
  featureItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "var(--color-ink-2)",
  },
  featureDot: { width: 5, height: 5, borderRadius: "50%", flexShrink: 0, opacity: 0.7 },
  cardArrow: {
    position: "absolute",
    right: 20,
    bottom: 18,
    fontSize: 20,
    transition: "color 0.2s",
  },
  footer: {
    fontSize: 13,
    color: "var(--color-ink-3)",
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.02em",
  },
};
