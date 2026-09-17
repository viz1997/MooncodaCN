"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/routing";
import { formatPriceCNY, WJP_SERIES } from "./wjp-store-data";

/**
 * WJP 系列展示 —— 1:1 移植自 atelier `series-showcase.tsx`。
 *
 * 适配差异:
 *  - data source 从 atelier `series` + `products` 切换到本仓库 `WJP_SERIES`(钥匙扣/手办/冰箱贴)
 *  - atelier 的 "#keychain" 锚点跳转,本仓库用 "/image-gen?type=..." 启动生图工作台 (深链)
 */
export function SeriesShowcase() {
  return (
    <section id="series" className="bg-muted/30 py-12 lg:py-16 border-y">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            按品类逛
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            三种形态,全部由你的照片定制。
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 lg:gap-6">
          {WJP_SERIES.map((s, i) => (
            <motion.div
              key={s.id}
              id={s.id}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="group relative scroll-mt-20"
            >
              <Link
                href="/image-gen"
                className="block relative aspect-[4/3] overflow-hidden rounded-md bg-muted"
              >
                <img
                  src={s.cover}
                  alt={s.name}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                <div className="absolute bottom-0 inset-x-0 p-4 text-white">
                  <h3 className="text-lg font-semibold">{s.name}</h3>
                  <p className="text-xs text-white/80 mt-0.5">
                    起 {formatPriceCNY(s.fromPriceCNY)}
                  </p>
                </div>
                <span className="absolute top-3 right-3 size-8 rounded-full bg-white/15 backdrop-blur flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  <ArrowRight className="size-4" />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
