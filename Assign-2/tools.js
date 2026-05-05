import fs from "fs";
import path from "path";
import { exec } from "child_process";

const OUTPUT_DIR = "output";
const DEFAULT_TARGET_URL = "https://www.scaler.com/";
const MAX_SNIPPET_CHARS = 20_000;
const MAX_IMAGES = 35;

function parseArgs(input = "") {
  if (typeof input === "object" && input !== null) return input;
  const raw = String(input || "").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { url: raw };
  }
}

function normalizeUrl(rawUrl = "") {
  const value = String(rawUrl || DEFAULT_TARGET_URL).trim();
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return new URL(withProtocol).toString();
}

function resolveUrl(baseUrl, maybeRelative = "") {
  const value = String(maybeRelative || "").trim();
  if (!value || value.startsWith("data:") || value.startsWith("javascript:")) return "";
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function decodeEntities(text = "") {
  const entities = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
    ndash: "-",
    mdash: "-",
  };

  return String(text)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, name) => entities[name.toLowerCase()] || `&${name};`);
}

function attr(tag = "", name = "") {
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = String(tag).match(re);
  return match?.[1] || match?.[2] || match?.[3] || "";
}

function cleanText(html = "") {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/css;q=0.8,*/*;q=0.7",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

function extractTitle(html = "") {
  return cleanText(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "Website Clone");
}

function extractMetaDescription(html = "") {
  const tag = String(html).match(/<meta\b[^>]*(name|property)=["']description["'][^>]*>/i)?.[0] || "";
  return decodeEntities(attr(tag, "content"));
}

function extractBody(html = "") {
  return String(html).match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
}

function stripForSnippet(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, (svg) => (svg.length > 5000 ? "<!-- Large SVG removed -->" : svg))
    .replace(/\s{2,}/g, " ")
    .trim();
}

function srcFromSrcset(srcset = "") {
  return String(srcset).split(",")[0]?.trim().split(/\s+/)[0] || "";
}

function extractImagesFromHtml(html = "", baseUrl = "") {
  const images = [];
  const imgTags = [...String(html).matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);

  for (const tag of imgTags) {
    const rawSrc = attr(tag, "src") || attr(tag, "data-src") || attr(tag, "data-lazy-src") || srcFromSrcset(attr(tag, "srcset"));
    const src = resolveUrl(baseUrl, rawSrc);
    if (src && !src.includes("base64")) {
      images.push({ src, alt: cleanText(attr(tag, "alt")) });
    }
  }

  const styledTags = [...String(html).matchAll(/<[^>]+\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi)];
  for (const match of styledTags) {
    const style = match[1] || match[2] || "";
    const urls = [...style.matchAll(/url\((['"]?)(.*?)\1\)/gi)].map((urlMatch) => urlMatch[2]);
    for (const rawUrl of urls) {
      const src = resolveUrl(baseUrl, rawUrl);
      if (src && !src.includes("base64")) images.push({ src, alt: "background image" });
    }
  }

  return uniqueBy(images, (image) => image.src).slice(0, MAX_IMAGES);
}

function extractStylesheetUrls(html = "", baseUrl = "") {
  const links = [...String(html).matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  return links
    .filter((tag) => /rel\s*=\s*["'][^"']*stylesheet/i.test(tag))
    .map((tag) => resolveUrl(baseUrl, attr(tag, "href")))
    .filter(Boolean)
    .slice(0, 6);
}

function extractBackgroundImagesFromCss(css = "", baseUrl = "") {
  const urls = [...String(css).matchAll(/url\((['"]?)(.*?)\1\)/gi)].map((match) => match[2]);
  return urls
    .map((rawUrl) => resolveUrl(baseUrl, rawUrl))
    .filter((src) => src && !src.includes("base64") && /\.(png|jpe?g|webp|svg|gif)(\?|$)/i.test(src))
    .map((src) => ({ src, alt: "stylesheet background image" }));
}

function extractHeadings(html = "") {
  return [...String(html).matchAll(/<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => ({ level: match[1].toLowerCase(), text: cleanText(match[2]) }))
    .filter((heading) => heading.text)
    .slice(0, 30);
}

function extractLinks(html = "", baseUrl = "") {
  return uniqueBy(
    [...String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
      .map((match) => ({ href: resolveUrl(baseUrl, attr(match[1], "href")), text: cleanText(match[2]) }))
      .filter((link) => link.text && link.text.length <= 100),
    (link) => `${link.text.toLowerCase()}|${link.href}`
  ).slice(0, 40);
}

function extractColors(css = "") {
  const ignored = new Set(["#fff", "#ffffff", "#000", "#000000", "#0000", "#00000000", "transparent"]);
  const counts = new Map();
  const matches = String(css).match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) || [];

  for (const value of matches) {
    const color = value.toLowerCase().replace(/\s+/g, "");
    if (ignored.has(color) || /^rgba?\(0,0,0,0/.test(color)) continue;
    counts.set(color, (counts.get(color) || 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color).slice(0, 12);
}

function resolveOutputPath(filePath = "") {
  const cleaned = String(filePath || "").replace(/^\.?\/?output\//, "");
  const outputRoot = path.resolve(OUTPUT_DIR);
  const fullPath = path.resolve(outputRoot, cleaned);
  if (!fullPath.startsWith(outputRoot + path.sep) && fullPath !== outputRoot) {
    throw new Error("File path must stay inside the output directory.");
  }
  return fullPath;
}

export async function writeFile(args = "") {
  try {
    const { filePath, content } = parseArgs(args);
    if (!filePath || content === undefined) {
      return JSON.stringify({ status: "Error", message: "writeFile requires filePath and content." });
    }

    const fullPath = resolveOutputPath(filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");

    return JSON.stringify({ status: "Success", message: `Wrote ${content.length} characters to ${path.relative(process.cwd(), fullPath)}` });
  } catch (err) {
    return JSON.stringify({ status: "Error", message: err.message });
  }
}

export async function readFile(args = "") {
  try {
    const { filePath } = parseArgs(args);
    if (!filePath) return JSON.stringify({ status: "Error", message: "readFile requires filePath." });

    const fullPath = resolveOutputPath(filePath);
    const content = fs.readFileSync(fullPath, "utf-8");
    return JSON.stringify({ status: "Success", filePath: path.relative(process.cwd(), fullPath), content });
  } catch (err) {
    return JSON.stringify({ status: "Error", message: err.message });
  }
}

export async function reviewClone(args = "") {
  try {
    const parsed = parseArgs(args);
    const target = String(parsed.target || parsed.url || "scaler").toLowerCase();
    const htmlPath = resolveOutputPath(parsed.htmlFile || "index.html");
    const cssPath = resolveOutputPath(parsed.cssFile || "styles.css");
    const jsPath = resolveOutputPath(parsed.jsFile || "script.js");

    const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, "utf-8") : "";
    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf-8") : "";
    const js = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, "utf-8") : "";
    const combined = `${html}\n${css}\n${js}`.toLowerCase();

    const checks = [
      { name: "index.html exists", passed: html.length > 0, fix: "Write output/index.html." },
      { name: "styles.css exists", passed: css.length > 0, fix: "Write output/styles.css." },
      { name: "script.js exists", passed: js.length > 0, fix: "Write output/script.js, even if minimal." },
      { name: "responsive viewport meta", passed: /<meta[^>]+viewport/i.test(html), fix: "Add a viewport meta tag to index.html." },
      { name: "stylesheet linked", passed: /href=[\"']styles\.css[\"']/i.test(html), fix: "Link styles.css from index.html." },
      { name: "script linked", passed: /src=[\"']script\.js[\"']/i.test(html), fix: "Link script.js from index.html." },
      { name: "semantic header", passed: /<header\b/i.test(html) || /<nav\b/i.test(html), fix: "Add a header/nav section." },
      { name: "hero section", passed: /hero/i.test(html), fix: "Add a prominent hero section." },
      { name: "footer section", passed: /<footer\b/i.test(html), fix: "Add a footer section." },
    ];

    if (target.includes("scaler")) {
      checks.push(
        { name: "Scaler logo", passed: /scaler-logo|scaler/i.test(html) && /<img/i.test(html), fix: "Add the Scaler logo image from the scraped assets in the header." },
        { name: "PROGRAM nav item", passed: /\bprogram\b/i.test(html), fix: "Add PROGRAM to the navigation." },
        { name: "MASTERCLASS nav item", passed: /\bmasterclass\b/i.test(html), fix: "Add MASTERCLASS to the navigation." },
        { name: "AI LABS nav item", passed: /\bai labs\b/i.test(html), fix: "Add AI LABS to the navigation." },
        { name: "ALUMNI nav item", passed: /\balumni\b/i.test(html), fix: "Add ALUMNI to the navigation." },
        { name: "RESOURCES nav item", passed: /\bresources\b/i.test(html), fix: "Add RESOURCES to the navigation." },
        { name: "Login button", passed: /\blogin\b/i.test(html), fix: "Add a Login button/link in the header before Placement Report." },
        { name: "Placement Report button", passed: /placement report/i.test(html), fix: "Add a Placement Report button/link in the header." },
        { name: "primary hero headline", passed: /become the professional/i.test(html) && /next decade in ai/i.test(html), fix: "Use the Scaler hero headline with the correct line emphasis." },
        { name: "hero line break controls", passed: /hero-line|<br\s*\/?>|headline-line/i.test(html), fix: "Wrap hero headline lines in spans or use br tags so the line breaks are controlled." },
        { name: "program marquee/cards", passed: /modern software/i.test(html) && /data science/i.test(html) && /devops/i.test(html), fix: "Add the program marquee/cards with Scaler program names." },
        { name: "callback CTA", passed: /request a callback/i.test(html), fix: "Add Request A Callback CTA." },
        { name: "free class CTA", passed: /book free live class/i.test(html), fix: "Add Book Free Live Class CTA." }
      );
    }

    const failed = checks.filter((check) => !check.passed);

    return JSON.stringify({
      status: failed.length ? "NeedsPatch" : "Passed",
      target,
      summary: `${checks.length - failed.length}/${checks.length} checks passed`,
      failed,
      instruction: failed.length
        ? "Patch the generated files with writeFile before opening the browser. Prioritize failed checks exactly."
        : "All checklist checks passed. You may open the browser.",
    }, null, 2);
  } catch (err) {
    return JSON.stringify({ status: "Error", message: err.message });
  }
}

export async function fetchWebContent(args = "") {
  try {
    const { url } = parseArgs(args);
    const targetUrl = normalizeUrl(url);
    const html = await fetchText(targetUrl);
    const body = extractBody(html);
    const stylesheetUrls = extractStylesheetUrls(html, targetUrl);
    const cssResults = await Promise.allSettled(stylesheetUrls.map((href) => fetchText(href)));
    const css = cssResults
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value)
      .join("\n")
      .slice(0, 160_000);

    const htmlImages = extractImagesFromHtml(body, targetUrl);
    const cssImages = cssResults
      .flatMap((result, index) => result.status === "fulfilled" ? extractBackgroundImagesFromCss(result.value, stylesheetUrls[index]) : []);
    const images = uniqueBy([...htmlImages, ...cssImages], (image) => image.src).slice(0, MAX_IMAGES);
    const snippet = stripForSnippet(body).slice(0, MAX_SNIPPET_CHARS);

    return JSON.stringify({
      status: "Success",
      url: targetUrl,
      title: extractTitle(html),
      description: extractMetaDescription(html),
      images,
      headings: extractHeadings(body),
      links: extractLinks(body, targetUrl),
      colors: extractColors(css),
      snippet,
      message: "Use the snippet's real class names, layout order, SVG/logo markup, and image URLs to create a visually faithful responsive clone. Do not copy scripts; write your own simple JS only if needed.",
    });
  } catch (err) {
    return JSON.stringify({ status: "Error", message: err.message });
  }
}

export async function executeCommand(cmd = "") {
  return new Promise((resolve) => {
    exec(String(cmd), { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        resolve(`Command error: ${error.message}\nStderr: ${stderr}`);
      } else {
        resolve(`Command executed: "${cmd}"\nOutput: ${stdout || "(no output)"}`);
      }
    });
  });
}

export async function openInBrowser(args = "") {
  const parsed = parseArgs(args);
  const filePath = parsed.filePath || parsed.path || args || "index.html";
  const resolvedPath = resolveOutputPath(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return JSON.stringify({ status: "Error", message: `File ${path.relative(process.cwd(), resolvedPath)} does not exist.` });
  }

  const platform = process.platform;
  let cmd;
  if (platform === "darwin") cmd = `open "${resolvedPath}"`;
  else if (platform === "win32") cmd = `start "" "${resolvedPath}"`;
  else cmd = `xdg-open "${resolvedPath}"`;

  return new Promise((resolve) => {
    exec(cmd, (error) => {
      if (error) resolve(JSON.stringify({ status: "Error", message: error.message }));
      else resolve(JSON.stringify({ status: "Success", message: `Opened ${path.relative(process.cwd(), resolvedPath)}` }));
    });
  });
}

export const tool_map = {
  writeFile,
  readFile,
  reviewClone,
  fetchWebContent,
  executeCommand,
  openInBrowser,
};
