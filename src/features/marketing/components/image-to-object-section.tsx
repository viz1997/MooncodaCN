"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  Camera,
  Heart,
  Sparkles,
  Star,
  Wand2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Reveal } from "@/components/motion/reveal";
import { Paw, Sparkle as SparkleIcon } from "./decorations";

/**
 * ImageToObjectSection —— 从照片到实物的转场（潮玩手作视觉版）
 *
 * 视觉风格：宠物 × 潮玩盲盒
 * - 左侧 Polaroid 风格宠物照片（贴满 paw / heart / bone 贴纸）
 * - 中央魔法转场区：旋转爪印/爱心环 + POP 爆点 + 飞舞贴纸
 * - 右侧 3D 立体徽章成品（限量编号 + 全息光 + 独家印章）
 * - 周围散落多种宠物头像贴纸（狗/猫/兔/爪）
 * - 入场：左右卡倾斜滑入 + 中央转场依次弹出
 */

// ──────────────────────────────────────────────────────────
// 2D 扁平潮玩插画：奶橘猫
// ──────────────────────────────────────────────────────────
function PhotoCatIllustration() {
  return (
    <svg
      role="presentation"
      aria-hidden
      viewBox="0 0 120 120"
      className="h-full w-full"
    >
      <circle cx="60" cy="60" r="58" fill="var(--accent-blush-soft)" />
      <ellipse cx="60" cy="66" rx="36" ry="32" fill="#FFB97A" />
      <path
        d="M40 50 Q50 38 60 42 Q70 38 80 50 L75 58 Q60 50 45 58 Z"
        fill="#E89556"
      />
      <path d="M30 50 L36 28 L48 44 Z" fill="#E89556" />
      <path d="M90 50 L84 28 L72 44 Z" fill="#E89556" />
      <path d="M34 44 L38 32 L44 42 Z" fill="#FFB7C5" />
      <path d="M86 44 L82 32 L76 42 Z" fill="#FFB7C5" />
      <ellipse cx="60" cy="80" rx="22" ry="14" fill="#FFF4E5" />
      <ellipse cx="48" cy="68" rx="4.5" ry="6" fill="#2A2A2A" />
      <ellipse cx="72" cy="68" rx="4.5" ry="6" fill="#2A2A2A" />
      <circle cx="49.5" cy="65.5" r="1.6" fill="#fff" />
      <circle cx="46.5" cy="70" r="1" fill="#fff" />
      <circle cx="73.5" cy="65.5" r="1.6" fill="#fff" />
      <circle cx="70.5" cy="70" r="1" fill="#fff" />
      <path
        d="M60 78 L57 76 Q55 76 55 78 Q55 80 60 82 Q65 80 65 78 Q65 76 63 76 Z"
        fill="#FF8FA3"
      />
      <path
        d="M60 82 Q56 86 53 84 M60 82 Q64 86 67 84"
        stroke="#2A2A2A"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M40 78 L28 76 M40 82 L28 84 M80 78 L92 76 M80 82 L92 84"
        stroke="#2A2A2A"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.5"
      />
      <ellipse cx="38" cy="80" rx="5" ry="3" fill="#FFB7C5" opacity="0.7" />
      <ellipse cx="82" cy="80" rx="5" ry="3" fill="#FFB7C5" opacity="0.7" />
      <g transform="translate(60, 14)">
        <path
          d="M0 -5 L1.5 -1.5 L5 0 L1.5 1.5 L0 5 L-1.5 1.5 L-5 0 L-1.5 -1.5 Z"
          fill="#FFD27A"
        />
      </g>
    </svg>
  );
}

// ──────────────────────────────────────────────────────────
// 3D 立体徽章（带厚度 + 高光 + 阴影）
// ──────────────────────────────────────────────────────────
function ProductBadgeIllustration() {
  return (
    <svg
      role="presentation"
      aria-hidden
      viewBox="0 0 140 140"
      className="h-full w-full"
    >
      <defs>
        <radialGradient id="badgeTopShine" cx="38%" cy="30%" r="55%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.85)" />
          <stop offset="55%" stopColor="rgba(255,255,255,0.1)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <linearGradient id="badgeBase" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A87142" />
          <stop offset="100%" stopColor="#6B3F1F" />
        </linearGradient>
        <linearGradient id="holo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(255,200,220,0.4)" />
          <stop offset="50%" stopColor="rgba(255,230,150,0.3)" />
          <stop offset="100%" stopColor="rgba(180,230,255,0.4)" />
        </linearGradient>
      </defs>

      <ellipse cx="70" cy="125" rx="40" ry="6" fill="rgba(0,0,0,0.2)" />
      <ellipse cx="70" cy="112" rx="44" ry="12" fill="#7A4A22" />
      <ellipse cx="70" cy="108" rx="44" ry="12" fill="url(#badgeBase)" />
      <circle cx="70" cy="68" r="48" fill="#D49960" />
      <circle cx="70" cy="68" r="48" fill="url(#badgeTopShine)" />
      <ellipse
        cx="50"
        cy="42"
        rx="14"
        ry="5"
        fill="rgba(255,255,255,0.55)"
        transform="rotate(-25 50 42)"
      />
      <circle cx="70" cy="68" r="38" fill="#FFF8EC" />
      <circle cx="70" cy="68" r="38" fill="url(#holo)" />
      <circle
        cx="70"
        cy="68"
        r="38"
        fill="none"
        stroke="#E89556"
        strokeWidth="1.5"
        strokeDasharray="3 3"
        opacity="0.6"
      />
      <ellipse cx="70" cy="76" rx="24" ry="22" fill="#FFB97A" />
      <path
        d="M48 60 Q56 50 70 54 Q84 50 92 60 L88 66 Q70 58 52 66 Z"
        fill="#E89556"
      />
      <path d="M44 64 L48 44 L58 56 Z" fill="#E89556" />
      <path d="M96 64 L92 44 L82 56 Z" fill="#E89556" />
      <path d="M48 60 L50 46 L56 54 Z" fill="#FFB7C5" />
      <path d="M92 60 L90 46 L84 54 Z" fill="#FFB7C5" />
      <ellipse cx="70" cy="88" rx="14" ry="9" fill="#FFF4E5" />
      <ellipse cx="60" cy="76" rx="3" ry="4" fill="#2A2A2A" />
      <ellipse cx="80" cy="76" rx="3" ry="4" fill="#2A2A2A" />
      <circle cx="61" cy="74" r="1.2" fill="#fff" />
      <circle cx="81" cy="74" r="1.2" fill="#fff" />
      <path
        d="M70 84 L67 82.5 Q65 82.5 65 84 Q65 86 70 88 Q75 86 75 84 Q75 82.5 73 82.5 Z"
        fill="#FF8FA3"
      />
      <ellipse cx="55" cy="86" rx="3" ry="2" fill="#FFB7C5" opacity="0.7" />
      <ellipse cx="85" cy="86" rx="3" ry="2" fill="#FFB7C5" opacity="0.7" />
      <rect x="64" y="113" width="12" height="6" rx="2" fill="#8B5A2B" />
      <rect x="66" y="114" width="8" height="4" rx="1" fill="#A87142" />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────
// 限量印章 SVG（圆形封印）
// ──────────────────────────────────────────────────────────
function ExclusiveSeal() {
  return (
    <svg
      role="presentation"
      aria-hidden
      viewBox="0 0 60 60"
      className="h-full w-full"
    >
      <circle
        cx="30"
        cy="30"
        r="28"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle
        cx="30"
        cy="30"
        r="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      <text
        x="30"
        y="20"
        textAnchor="middle"
        fill="currentColor"
        fontSize="6"
        fontWeight="800"
      >
        ★ 独家 ★
      </text>
      <text
        x="30"
        y="34"
        textAnchor="middle"
        fill="currentColor"
        fontSize="11"
        fontWeight="900"
        letterSpacing="0.5"
      >
        LIMITED
      </text>
      <text
        x="30"
        y="44"
        textAnchor="middle"
        fill="currentColor"
        fontSize="5"
        fontWeight="700"
      >
        COLLECTION
      </text>
    </svg>
  );
}

// ──────────────────────────────────────────────────────────
// 主组件
// ──────────────────────────────────────────────────────────
export function ImageToObjectSection() {
  const t = useTranslations("ImageToObject");

  return (
    <section
      id="image-to-object"
      className="relative overflow-hidden py-20 md:py-28"
    >
      {/* 暖色光晕底 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(40% 35% at 20% 30%, var(--accent-coral-soft), transparent 70%), radial-gradient(45% 40% at 80% 70%, var(--accent-amber-soft), transparent 72%)",
        }}
      />

      {/* 散落贴纸装饰（满版宠物/潮玩感） */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {/* 左上 paw */}
        <div className="absolute top-[10%] left-[4%] text-coral/40 animate-float-slow">
          <Paw size={36} />
        </div>
        {/* 右上 heart */}
        <div className="absolute top-[6%] right-[3%] text-amber/60 animate-wobble">
          <Heart size={24} fill="currentColor" />
        </div>
        {/* 左下 star */}
        <div className="absolute bottom-[12%] left-[6%] text-primary/40 animate-float-slow">
          <Star size={28} fill="currentColor" />
        </div>
        {/* 右下 sparkle */}
        <div className="absolute bottom-[16%] right-[4%] text-coral/50 animate-wobble">
          <SparkleIcon size={32} />
        </div>
        {/* 中上 paw 小 */}
        <div className="absolute top-[18%] left-[44%] text-amber/40 animate-float-slow">
          <Paw size={22} />
        </div>
        {/* 中下 heart */}
        <div className="absolute bottom-[22%] left-[48%] text-coral/40 animate-wobble">
          <Heart size={20} fill="currentColor" />
        </div>
        {/* 左中 paw */}
        <div className="absolute top-[45%] left-[2%] text-amber/30 animate-float-slow">
          <Paw size={18} />
        </div>
        {/* 右中 star */}
        <div className="absolute top-[48%] right-[1%] text-coral/40 animate-wobble">
          <Star size={20} fill="currentColor" />
        </div>
        {/* 顶部 sparkle */}
        <div className="absolute top-[3%] left-[20%] text-amber/40 animate-float-slow">
          <SparkleIcon size={20} />
        </div>
        <div className="absolute top-[5%] right-[20%] text-coral/40 animate-wobble">
          <SparkleIcon size={24} />
        </div>
      </div>

      <div className="container relative">
        {/* 标题区 */}
        <Reveal>
          <div className="mb-8 flex flex-col items-center gap-4 text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-card px-4 py-1.5 shadow-sticker text-xs font-semibold">
              <Wand2 size={12} className="text-coral" />
              {t("label")}
            </span>
            <h2 className="text-balance text-3xl font-extrabold tracking-tight md:text-4xl">
              {t("title")}
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground md:text-base">
              {t("subtitle")}
            </p>
          </div>
        </Reveal>

        {/* 顶部宠物头像贴纸墙（潮玩盲盒收集感） */}
        <Reveal delay={0.04}>
          <div className="mb-12 flex items-center justify-center gap-3 md:gap-4">
            {[
              { emoji: "🐕", tone: "bg-coral-soft", rotate: "rotate-[-6deg]" },
              { emoji: "🐈", tone: "bg-amber-soft", rotate: "rotate-[4deg]" },
              { emoji: "🐰", tone: "bg-blush-soft", rotate: "rotate-[-3deg]" },
              { emoji: "🐹", tone: "bg-coral-soft", rotate: "rotate-[5deg]" },
              { emoji: "🦊", tone: "bg-amber-soft", rotate: "rotate-[-4deg]" },
              { emoji: "🐦", tone: "bg-blush-soft", rotate: "rotate-[3deg]" },
              { emoji: "🐢", tone: "bg-coral-soft", rotate: "rotate-[-5deg]" },
            ].map((pet) => (
              <div
                key={pet.emoji}
                className={`${pet.tone} ${pet.rotate} flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-white/60 text-2xl shadow-sticker transition-transform hover:rotate-0 hover:scale-110 md:h-14 md:w-14 md:text-3xl`}
              >
                {pet.emoji}
              </div>
            ))}
            <div className="bg-foreground ml-1 rotate-[8deg] rounded-2xl px-3 py-2 shadow-sticker">
              <div className="font-mono text-[9px] tracking-widest text-background uppercase">
                100+
              </div>
              <div className="font-mono text-[10px] font-bold text-amber">
                PETS
              </div>
            </div>
          </div>
        </Reveal>

        {/* 转场舞台 */}
        <Reveal delay={0.08}>
          <div className="relative mx-auto flex max-w-5xl flex-col items-center justify-center gap-8 md:flex-row md:gap-6">
            {/* ═══════ 左侧：照片卡 ═══════ */}
            <motion.div
              initial={{ opacity: 0, x: -40, rotate: -8 }}
              whileInView={{ opacity: 1, x: 0, rotate: -4 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="relative shrink-0"
            >
              {/* 周围贴纸：左上 paw */}
              <div className="bg-coral shadow-sticker-coral absolute -top-3 -left-4 z-10 flex h-11 w-11 rotate-[-12deg] items-center justify-center rounded-2xl">
                <Paw size={22} className="text-white" />
              </div>
              {/* 右上 heart */}
              <div className="bg-amber shadow-sticker-amber absolute -top-2 -right-3 z-10 flex h-10 w-10 rotate-[15deg] items-center justify-center rounded-full">
                <Heart size={18} className="text-white" fill="currentColor" />
              </div>
              {/* 右下 star */}
              <div className="bg-blush shadow-sticker absolute -bottom-3 -right-2 z-10 flex h-12 w-12 rotate-[10deg] items-center justify-center rounded-full">
                <Star size={24} className="text-amber" fill="currentColor" />
              </div>
              {/* 左下 bone emoji 贴纸 */}
              <div className="bg-white shadow-sticker absolute -bottom-2 -left-3 z-10 flex h-10 w-10 rotate-[-8deg] items-center justify-center rounded-2xl">
                <span className="text-lg">🦴</span>
              </div>

              {/* Polaroid 风格 */}
              <div className="bg-card relative w-64 rounded-[1.5rem] border-2 p-4 shadow-sticker md:w-72">
                {/* 顶部小贴纸 */}
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1 text-[10px] font-bold tracking-wider text-background uppercase">
                    <Camera size={10} />
                    {t("photoLabel")}
                  </span>
                </div>

                {/* 图片区 */}
                <div className="relative aspect-square overflow-hidden rounded-2xl bg-warm">
                  <PhotoCatIllustration />
                  <div className="pointer-events-none absolute inset-0 opacity-30 mix-blend-overlay">
                    <div
                      className="h-full w-full"
                      style={{
                        background:
                          "repeating-linear-gradient(45deg, transparent 0 8px, rgba(0,0,0,0.04) 8px 9px)",
                      }}
                    />
                  </div>
                  <div className="absolute right-2 bottom-2 rounded-md bg-foreground/70 px-2 py-0.5 font-mono text-[10px] text-background">
                    IMG_8472
                  </div>
                  {/* 手写日期 */}
                  <div className="bg-coral absolute top-2 left-2 rounded-md px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-white uppercase">
                    ✿ my baby
                  </div>
                  {/* 收藏印章 */}
                  <div className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-white text-coral shadow-sticker">
                    <Paw size={14} />
                  </div>
                </div>

                {/* Polaroid 底部留白 + 手写 */}
                <div className="mt-3 flex items-center justify-between px-1">
                  <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                    {t("photoMeta")}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs">🐱</span>
                    <Heart
                      size={10}
                      className="text-coral"
                      fill="currentColor"
                    />
                  </div>
                </div>
              </div>
            </motion.div>

            {/* ═══════ 中央：魔法转场 ═══════ */}
            <div className="relative flex h-44 w-full flex-col items-center justify-center md:h-auto md:w-52">
              {/* 横向虚线（md+） */}
              <svg
                role="presentation"
                aria-hidden
                className="text-coral hidden h-20 w-full md:block"
                viewBox="0 0 200 80"
                fill="none"
                preserveAspectRatio="none"
              >
                <path
                  d="M2 40 Q 50 20, 100 40 T 198 40"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray="6 6"
                />
              </svg>
              {/* 竖向虚线（mobile） */}
              <svg
                role="presentation"
                aria-hidden
                className="text-coral block h-24 w-12 md:hidden"
                viewBox="0 0 48 96"
                fill="none"
                preserveAspectRatio="none"
              >
                <path
                  d="M24 2 Q 8 24, 24 48 T 24 94"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray="6 6"
                />
              </svg>

              {/* 旋转的小爪印/爱心环（外圈） */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{
                  duration: 18,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "linear",
                }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ width: 150, height: 150 }}
              >
                <Paw
                  size={18}
                  className="absolute top-2 left-1/2 -translate-x-1/2 text-coral"
                />
                <Heart
                  size={16}
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-amber"
                  fill="currentColor"
                />
                <Paw
                  size={18}
                  className="absolute bottom-2 left-1/2 -translate-x-1/2 text-coral"
                />
                <Star
                  size={16}
                  className="absolute top-1/2 left-2 -translate-y-1/2 text-amber"
                  fill="currentColor"
                />
              </motion.div>

              {/* 中心魔法球（反向旋转） */}
              <motion.div
                animate={{ rotate: -360 }}
                transition={{
                  duration: 10,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "linear",
                }}
                className="bg-coral-soft shadow-sticker-coral absolute top-1/2 left-1/2 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-coral/40"
              >
                <div className="absolute inset-2 rounded-full bg-white" />
                <div className="absolute inset-2 rounded-full bg-gradient-to-br from-white via-transparent to-coral-soft opacity-60" />
                <Sparkles size={36} className="text-coral relative z-10" />
                {/* 球上小爪印装饰 */}
                <Paw
                  size={14}
                  className="text-coral absolute -top-1 -right-1 rotate-[15deg]"
                />
                <Heart
                  size={12}
                  className="text-coral absolute -bottom-1 -left-1 -rotate-[10deg]"
                  fill="currentColor"
                />
              </motion.div>

              {/* "POP" 爆点标签（中央最显眼） */}
              <motion.div
                initial={{ scale: 0, rotate: -20 }}
                whileInView={{ scale: 1, rotate: -10 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.5,
                  delay: 0.8,
                  type: "spring",
                  stiffness: 300,
                }}
                className="bg-coral absolute -top-6 left-1/2 z-20 -translate-x-1/2 rounded-full border-2 border-white px-4 py-1.5 text-[12px] font-extrabold tracking-wider text-white uppercase shadow-sticker-coral"
              >
                ✨ {t("transformLabel")} ✨
              </motion.div>

              {/* 飞舞的细小爪子/爱心 */}
              <motion.div
                animate={{ y: [-4, 4, -4] }}
                transition={{
                  duration: 3,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "easeInOut",
                }}
                className="absolute top-2 right-4 text-coral/70"
              >
                <Paw size={14} />
              </motion.div>
              <motion.div
                animate={{ y: [4, -4, 4] }}
                transition={{
                  duration: 3.5,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "easeInOut",
                }}
                className="absolute bottom-2 left-4 text-amber/70"
              >
                <Heart size={12} fill="currentColor" />
              </motion.div>
            </div>

            {/* ═══════ 右侧：成品徽章卡 ═══════ */}
            <motion.div
              initial={{ opacity: 0, x: 40, rotate: 8 }}
              whileInView={{ opacity: 1, x: 0, rotate: 4 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, ease: "easeOut", delay: 0.15 }}
              className="relative shrink-0"
            >
              {/* 周围贴纸 */}
              {/* 限量编号贴纸（右上） */}
              <div className="bg-foreground shadow-sticker absolute -top-5 -right-4 z-10 rotate-[12deg] rounded-2xl border-2 border-amber/40 px-3 py-1.5">
                <div className="font-mono text-[9px] tracking-widest text-amber uppercase">
                  EDITION
                </div>
                <div className="font-mono text-base font-extrabold leading-none text-background">
                  N°001
                </div>
              </div>
              {/* 左上 sparkle */}
              <div className="bg-coral shadow-sticker-coral absolute -top-3 -left-4 z-10 flex h-11 w-11 rotate-[-15deg] items-center justify-center rounded-2xl">
                <SparkleIcon size={24} className="text-white" />
              </div>
              {/* 右下 heart */}
              <div className="bg-amber shadow-sticker-amber absolute -bottom-3 -right-2 z-10 flex h-11 w-11 rotate-[8deg] items-center justify-center rounded-full">
                <Heart size={20} className="text-white" fill="currentColor" />
              </div>
              {/* 左下 paw */}
              <div className="bg-blush shadow-sticker absolute -bottom-2 -left-3 z-10 flex h-10 w-10 rotate-[-10deg] items-center justify-center rounded-full">
                <Paw size={20} className="text-coral" />
              </div>
              {/* 独家印章（左上角） */}
              <div className="text-coral absolute top-4 -left-8 z-10 h-16 w-16 rotate-[-15deg] opacity-90">
                <ExclusiveSeal />
              </div>

              {/* 成品卡（暖色底，微浮起） */}
              <div className="bg-coral-soft shadow-sticker-coral relative w-64 rounded-[1.5rem] border-2 border-coral/30 p-4 md:w-72 md:scale-105">
                {/* 顶部 badge */}
                <div className="absolute -top-3 left-4">
                  <span className="inline-flex items-center gap-1 rounded-full bg-coral px-3 py-1 text-[10px] font-bold tracking-wider text-white uppercase shadow-sticker-coral">
                    <BadgeCheck size={11} />
                    {t("productBadge")}
                  </span>
                </div>

                {/* 成品图区 */}
                <div className="relative aspect-square overflow-hidden rounded-2xl bg-white">
                  <ProductBadgeIllustration />
                  {/* 角落颜色装饰 */}
                  <span className="bg-coral absolute top-3 left-3 h-3 w-3 rounded-full opacity-70" />
                  <span className="bg-amber absolute top-3 right-3 h-3 w-3 rounded-full opacity-70" />
                  <span className="bg-primary absolute bottom-3 left-3 h-3 w-3 rounded-full opacity-70" />
                  <span className="bg-blush absolute bottom-3 right-3 h-3 w-3 rounded-full opacity-70" />
                  {/* 全息光斑 */}
                  <div
                    aria-hidden
                    className="absolute inset-0 rounded-2xl opacity-40 mix-blend-overlay"
                    style={{
                      background:
                        "linear-gradient(115deg, transparent 30%, rgba(255,200,220,0.5) 45%, rgba(255,230,150,0.4) 55%, rgba(180,230,255,0.5) 65%, transparent 80%)",
                    }}
                  />
                </div>

                {/* 底部说明 */}
                <div className="mt-3 flex items-center justify-between px-1">
                  <div>
                    <div className="text-sm font-extrabold tracking-tight">
                      {t("productName")}
                    </div>
                    <div className="font-mono text-[10px] tracking-wider text-coral uppercase">
                      {t("productMeta")}
                    </div>
                  </div>
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg shadow-sticker">
                    🏅
                  </div>
                </div>

                {/* 左下角小箭头指向（摆动） */}
                <motion.div
                  animate={{ x: [-3, 3, -3] }}
                  transition={{
                    duration: 2,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "easeInOut",
                  }}
                  className="text-coral absolute -bottom-2 -right-12 hidden md:flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sticker"
                >
                  <ArrowRight size={14} />
                </motion.div>
              </div>
            </motion.div>
          </div>
        </Reveal>

        {/* 底部小说明 */}
        <Reveal delay={0.2}>
          <div className="mt-14 flex flex-col items-center gap-3 text-center">
            <p className="text-sm font-semibold tracking-tight text-foreground">
              {t("caption")}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="bg-coral-soft flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-coral">
                  1
                </span>
                {t("steps.s1")}
              </span>
              <span className="text-coral">→</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="bg-amber-soft flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-amber">
                  2
                </span>
                {t("steps.s2")}
              </span>
              <span className="text-coral">→</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="bg-blush-soft flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-coral">
                  3
                </span>
                {t("steps.s3")}
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
