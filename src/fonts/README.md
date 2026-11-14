# 自托管字体

这三套字体的文件是 **`pnpm fonts:sync` 拉下来的产物**,提交进仓库。

## 为什么自托管

原来走 `next/font/google` —— 构建期去 Google 拉字体。2026-11-14 Vercel 上
构建直接炸了:Google 偶尔返回**没有扩展名**的字体地址,Next 16.1.4 的
Turbopack 解析不了(上游 vercel/next.js#99114)⇒ **构建结果取决于当天
Google 返回什么**。自托管之后构建期不再碰 Google。

顺带:境内访问 fonts.gstatic.com 不稳,自托管之后字体跟站点同源。

## 目录

| 目录 | 字体 | 怎么用 |
|---|---|---|
| `inter/` | Inter(latin, 可变字重 100–900) | `next/font/local`(`src/app/layout.tsx`) |
| `playfair-display/` | Playfair Display(latin, normal + italic) | `next/font/local` |
| `noto-serif-sc/` | Noto Serif SC(101 个切片) | 手写 `@font-face`(`noto-serif-sc/font.css`) |

## 为什么中文那一套不用 `next/font/local`

汉字字体是**按码位切片**的,靠 `unicode-range` 告诉浏览器每个文件管哪一段
字形 ⇒ 页面只用到哪几个字就只下哪几个切片。
`next/font/local` **没有 unicode-range 这个口子** ⇒ 用它的话 101 个切片
会被浏览器**全下下来**(6MB/页)。所以中文这一套是手写 `@font-face`。

## 拉丁字体只留了 latin 子集

`next/font/local` 也不支持 unicode-range ⇒ 一个文件只能对应一个子集。
latin-ext(ā ő ū 那些)在中文/英文站点上几乎不会出现,缺了也只是
逐字形回退到系统字体。中文那一套是手写 CSS ⇒ **子集是全的**。

## ⚠️ `localFont` 的绑定名 = 全局的 `font-family` 名

`next/font/local` 生成的 `@font-face` 里,`font-family` 用的就是 SWC 注入的
`variableName`,而那个名字是**按调用处的绑定标识符**生成的 ——
`src/app/layout.tsx` 里是 `const inter = localFont(...)` /
`const playfair = localFont(...)` ⇒ 构建产物里就是
`font-family:inter` / `font-family:playfair`。

⇒ **两个文件里的两个 `localFont` 绑到同一个名字 = 两套 `@font-face` 共用
一个 family = 浏览器按先到先得挑 = 字形悄悄变成另一个字体**(页面上看不出
异常)。`src/test/repo/pure/self-hosted-fonts.test.ts` 守着「全仓绑定名唯一」。

## 许可

三套字体都是 **SIL Open Font License 1.1**(可自由自托管 / 再分发),
许可正文在各自目录的 `OFL.txt` 里。

## 重新拉

```bash
pnpm fonts:sync
```

脚本用 **Next 自己那个 User-Agent** 发请求(抄
`next/dist/compiled/@next/font/dist/google/fetch-resource.js`)——
换个 UA,Google 会返回不同的子集切法,文件就对不上了。

当前体积:Noto Serif SC 5.75 MB / 101 个切片 / 202 条 @font-face。

Inter: normal 100 900

Playfair Display: italic 400 700, normal 400 700
