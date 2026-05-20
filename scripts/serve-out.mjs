import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const port = Number(process.env.PORT || 4174);
const root = path.resolve("out");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

http
  .createServer((req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    let requestPath = decodeURIComponent(url.pathname);
    if (requestPath === "/") requestPath = "/index.html";

    const filePath = path.resolve(root, `.${requestPath}`);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, body) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.writeHead(200, {
        "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      res.end(body);
    });
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`Static export running at http://127.0.0.1:${port}/`);
  });
