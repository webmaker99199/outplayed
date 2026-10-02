import { execSync } from "child_process";
import fs from "fs";
import path from "path";

console.log("==> Building server with esbuild...");
execSync(
  "esbuild server/standalone.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
  { stdio: "inherit" }
);

console.log("==> Copying public assets to dist...");
const publicDir = path.resolve("public");
const distDir = path.resolve("dist");

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy public directory contents to dist directory recursively
fs.cpSync(publicDir, distDir, { recursive: true });

// Ensure _redirects exists in dist for Netlify SPA routing
const redirectsContent = `/api/*  /.netlify/functions/api/:splat  200\n/*      /index.html                     200\n`;
fs.writeFileSync(path.join(distDir, "_redirects"), redirectsContent, "utf8");

// Also copy data JSON files if needed for local fallback
["products.json", "shop.json", "sellauth_products.json", "sellauth_categories.json"].forEach(file => {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(distDir, file));
  }
});

// Verify dist/index.html exists
if (!fs.existsSync(path.join(distDir, "index.html"))) {
  console.error("ERROR: dist/index.html was not generated!");
  process.exit(1);
}

console.log("==> Build successful! Publish directory 'dist' is ready with index.html.");
