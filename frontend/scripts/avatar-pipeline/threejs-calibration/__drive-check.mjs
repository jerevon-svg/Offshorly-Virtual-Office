import puppeteer from "puppeteer";

const OUT = "/private/tmp/claude-501/-Users-lekoffshorly-Documents-AI-Agents/2b4aff32-d85e-4685-80c3-bb6530473ab1/scratchpad/run-check";
const URL = "http://localhost:5173/virtual-office/";
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2000));
await page.screenshot({ path: `${OUT}/01-initial.png`, fullPage: false });

console.log("ERRORS:", JSON.stringify(errors.slice(0, 20)));
await browser.close();
