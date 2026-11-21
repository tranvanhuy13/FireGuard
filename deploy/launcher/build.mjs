import { mkdir, writeFile, copyFile } from "node:fs/promises";

function origin(name) {
  const url = new URL(process.env[name] || "");
  if (url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be a public HTTPS origin without a path`);
  }
  return url.origin;
}

const config = {
  frontend: origin("FRONTEND_URL"),
  backend: origin("BACKEND_URL"),
};
await mkdir(new URL("./dist/", import.meta.url), { recursive: true });
for (const file of ["index.html", "launcher.js"]) {
  await copyFile(new URL(file, import.meta.url), new URL(`dist/${file}`, import.meta.url));
}
await writeFile(new URL("dist/config.json", import.meta.url), JSON.stringify(config));
