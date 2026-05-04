import React from "react";
import { C, FONT, SHADOW } from "@/styles";
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
          <h1 style={s.logoTitle}>LangListen</h1>
        </div>

        <div style={s.cards}>
          <ModeCard
            badge={<Badge color="blue">标注模式</Badge>}
            title="音频标注"
            desc="打开音频文件，在波形上划定片段、填写备注，导出携带 Whisper 转写文本的 ZIP 数据包。"
            accentColor={C.blue}
            features={["波形可视化标注", "片段备注", "Whisper 转写", "导出 ZIP 数据包"]}
            onClick={() => onSelect("annotate")}
          />
          <ModeCard
            badge={<Badge color="green">练习模式</Badge>}
            title="精听练习"
            desc="导入 ZIP 数据包，逐片段反复听写，Diff 对照原文查漏补缺，随时标记需要重听的片段。"
            accentColor={C.green}
            features={["逐片段听写", "原文 Diff 对照", "标记重听", "全键盘操作"]}
            onClick={() => onSelect("listen")}
          />
          <ModeCard
            badge={<Badge color="blue">有声书模式</Badge>}
            title="听有声书"
            desc="打开 M4B 有声书，自动解析章节，支持变速播放，进度自动保存。"
            accentColor="#F97316"
            features={["自动解析章节", "0.5×～1.75× 变速", "进度自动记忆", "支持 M4B"]}
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
        borderColor: hovered ? accentColor + "66" : C.border2,
        boxShadow: hovered ? `0 8px 32px ${accentColor}18, ${SHADOW.md}` : SHADOW.md,
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
        <div style={{ ...s.cardArrow, color: hovered ? accentColor : C.border2 }}>→</div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    width: "100vw", height: "100vh",
    display: "flex", alignItems: "center", justifyContent: "center",
    background: C.paper2, position: "relative", overflow: "hidden",
  },
  texture: {
    position: "absolute", inset: 0,
    backgroundImage: `
      linear-gradient(${C.border} 1px, transparent 1px),
      linear-gradient(90deg, ${C.border} 1px, transparent 1px)
    `,
    backgroundSize: "40px 40px",
    opacity: 0.6, pointerEvents: "none",
  },
  content: {
    position: "relative", display: "flex", flexDirection: "column",
    alignItems: "center", gap: 40, animation: "fadeIn 0.4s ease both",
  },
  logoWrap: { textAlign: "center" },
  logoEyebrow: {
    fontFamily: FONT.mono, fontSize: 12, letterSpacing: "0.14em",
    textTransform: "uppercase" as const, color: C.ink3, marginBottom: 10,
  },
  logoTitle: {
    fontFamily: FONT.serif, fontSize: 46, fontWeight: 400,
    color: C.ink, letterSpacing: "-0.5px", lineHeight: 1.15, marginBottom: 10,
  },
  logoSub: { fontSize: 15, color: C.ink3, fontWeight: 300 },
  // 三列网格
  cards: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 20,
    width: 1020,
  },
  card: {
    background: C.paper, border: `1px solid ${C.border2}`, borderRadius: 16,
    cursor: "pointer", position: "relative", overflow: "hidden",
    transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s",
  },
  stripe: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  cardInner: { padding: "28px 26px 24px 32px", display: "flex", flexDirection: "column" as const },
  cardTitle: { fontFamily: FONT.sans, fontSize: 18, fontWeight: 500, marginBottom: 10 },
  cardDesc: { fontSize: 13, color: C.ink3, lineHeight: 1.65, marginBottom: 16 },
  featureList: {
    listStyle: "none", display: "flex", flexDirection: "column" as const,
    gap: 6, marginBottom: 20,
  },
  featureItem: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.ink2 },
  featureDot: { width: 5, height: 5, borderRadius: "50%", flexShrink: 0, opacity: 0.7 },
  cardArrow: { position: "absolute", right: 20, bottom: 18, fontSize: 20, transition: "color 0.2s" },
  footer: { fontSize: 13, color: C.ink3, fontFamily: FONT.mono, letterSpacing: "0.02em" },
};