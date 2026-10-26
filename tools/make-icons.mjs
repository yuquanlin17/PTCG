import sharp from "sharp";
const dir = new URL("../icons/", import.meta.url);
const svg = await import("node:fs").then((fs) => fs.readFileSync(new URL("icon.svg", dir)));
for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512], ["icon-32.png", 32]])
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(new URL(name, dir).pathname.replace(/^\/(\w:)/, "$1"));
// 安卓「可裁切」图标：四周留白，外圈会被系统切成圆形
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#0c0e15" } })
  .composite([{ input: await sharp(svg, { density: 300 }).resize(410, 410).png().toBuffer(), gravity: "center" }]).png()
  .toFile(new URL("icon-maskable-512.png", dir).pathname.replace(/^\/(\w:)/, "$1"));
console.log("ok");