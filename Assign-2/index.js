import "dotenv/config";
import { OpenAI } from "openai";
import readline from "readline";
import { tool_map } from "./tools.js";

const client = new OpenAI({
  baseURL: process.env.BASE_URL || "https://openrouter.ai/api/v1",
  apiKey: process.env.API_KEY || process.env.OPENROUTER_API_KEY,
});

const MODEL = process.env.MODEL_NAME || "xiaomi/mimo-v2-flash";
const MAX_TOOL_CALLS = 28;

if (!client.apiKey) {
  console.error("Error: set OPENROUTER_API_KEY or API_KEY in .env");
  process.exit(1);
}

const tools = [
  {
    type: "function",
    function: {
      name: "fetchWebContent",
      description: "Fetches live website HTML context, real image URLs, headings, links, colors, and SVG/logo snippets for cloning.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The website URL to scrape. Use https://www.scaler.com/ when the user asks for Scaler without a URL.",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "writeFile",
      description: "Writes a complete file inside the output directory. Use this for index.html, styles.css, and script.js.",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "File path relative to output, for example index.html, styles.css, or script.js.",
          },
          content: {
            type: "string",
            description: "The complete file content.",
          },
        },
        required: ["filePath", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "readFile",
      description: "Reads a file from the output directory so you can inspect or revise generated code.",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "File path relative to output.",
          },
        },
        required: ["filePath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reviewClone",
      description: "Reviews generated output files against a quality checklist. For Scaler, checks header/nav, Login, Placement Report, hero line breaks, CTAs, programs, footer, and responsiveness basics.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "The target website name or URL, for example scaler.",
          },
          htmlFile: {
            type: "string",
            description: "HTML file to review, usually index.html.",
          },
          cssFile: {
            type: "string",
            description: "CSS file to review, usually styles.css.",
          },
          jsFile: {
            type: "string",
            description: "JS file to review, usually script.js.",
          },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "openInBrowser",
      description: "Opens an output HTML file in the default browser.",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "HTML file path relative to output, usually index.html.",
          },
        },
        required: ["filePath"],
      },
    },
  },
];

const systemInstruction = `You are a CLI website-cloning agent and expert frontend engineer.

Primary goal:
Build a visually faithful, responsive local clone of the target website using live scraped evidence.

Rules:
- For any website cloning task, first call fetchWebContent with the target URL.
- If the user asks for Scaler without a URL, use https://www.scaler.com/.
- Write all generated files to output using writeFile.
- Generate at least index.html, styles.css, and script.js.
- Use the scraped snippet's real structure, section order, class names, SVG/logo snippets, headings, copy, and image URLs where useful.
- Pay close attention to Scaler's header, hero, program cards/sections, colors, typography, footer, spacing, and responsive behavior.
- For Scaler, the header MUST include logo, PROGRAM, MASTERCLASS, AI LABS, ALUMNI, RESOURCES, Login, and Placement Report.
- For Scaler, preserve hero headline line breaks with spans or br tags. Avoid accidental wrapping by setting sensible max-width, font-size, line-height, and responsive breakpoints.
- For Scaler, include the program marquee/cards and both CTAs: Request A Callback and Book Free Live Class.
- Do not use a hardcoded prebuilt Scaler template.
- Do not copy original scripts. Write simple original JavaScript only for menus, sliders, tabs, or small interactions.
- Prefer a polished static clone over a generic summary page.
- If the first scrape is sparse, still produce a complete clone from the evidence available.
- Two-pass workflow is mandatory:
  1. Generate index.html, styles.css, and script.js with writeFile.
  2. Call reviewClone before opening the browser.
  3. If reviewClone reports NeedsPatch, patch the files with writeFile and call reviewClone again.
  4. Only call openInBrowser after the checklist passes or after you have patched every failed item.
- Keep user-facing messages concise. Explain the plan briefly, then execute tools.
`;

const messages = [{ role: "system", content: systemInstruction }];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let rlClosed = false;
rl.on("close", () => {
  rlClosed = true;
});

function askUser(prompt) {
  if (rlClosed) return Promise.resolve("exit");

  return new Promise((resolve) => {
    const onClose = () => resolve("exit");
    rl.once("close", onClose);
    rl.question(prompt, (answer) => {
      rl.off("close", onClose);
      resolve(answer);
    });
  });
}

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  purple: "\x1b[35m", cyan: "\x1b[36m", green: "\x1b[32m",
  yellow: "\x1b[33m", red: "\x1b[31m", white: "\x1b[37m", bgPurple: "\x1b[45m",
};

function logTool(name, args) {
  const target = args?.filePath || args?.url || "";
  console.log(`${C.yellow}${C.bold}[tool]${C.reset} ${name}${target ? ` -> ${target}` : ""}`);
}

async function processResponse() {
  let toolCalls = 0;

  while (true) {
    process.stdout.write(`${C.dim}Agent is thinking...${C.reset}`);

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      temperature: 0.2,
      max_tokens: 8192,
    });

    process.stdout.write("\r\x1b[K");

    const responseMessage = completion.choices?.[0]?.message;
    if (!responseMessage) {
      console.log(`${C.red}No response from model.${C.reset}`);
      break;
    }

    messages.push(responseMessage);

    if (responseMessage.content) {
      console.log(`\n${C.cyan}Agent:${C.reset} ${responseMessage.content}`);
    }

    if (!responseMessage.tool_calls?.length) break;

    for (const toolCall of responseMessage.tool_calls) {
      const toolName = toolCall.function.name;
      const toolFn = tool_map[toolName];
      let toolArgs = {};

      try {
        toolArgs = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        toolArgs = {};
      }

      logTool(toolName, toolArgs);

      const result = toolFn
        ? await toolFn(toolArgs)
        : JSON.stringify({ status: "Error", message: `Unknown tool: ${toolName}` });

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolName,
        content: result,
      });
    }

    toolCalls += responseMessage.tool_calls.length;
    if (toolCalls >= MAX_TOOL_CALLS) {
      console.log(`${C.yellow}Reached tool-call limit. Pausing for the next instruction.${C.reset}`);
      break;
    }
  }
}

async function main() {
  console.log(`
${C.bgPurple}${C.white}${C.bold}                                                ${C.reset}
${C.bgPurple}${C.white}${C.bold}    LIVE WEBSITE CLONE AGENT                    ${C.reset}
${C.bgPurple}${C.white}${C.bold}    Model: ${MODEL.padEnd(34).slice(0, 34)}${C.reset}
${C.bgPurple}${C.white}${C.bold}                                                ${C.reset}

${C.dim}Type an instruction. Example: Clone the Scaler website${C.reset}
${C.dim}Generated files go to output/. Type exit to quit.${C.reset}
`);

  while (true) {
    const userInput = await askUser(`\n${C.purple}${C.bold}You: ${C.reset}`);
    if (!userInput || ["exit", "quit"].includes(userInput.trim().toLowerCase())) {
      console.log(`${C.dim}Goodbye. Check output/ for generated files.${C.reset}`);
      rl.close();
      break;
    }

    messages.push({ role: "user", content: userInput });

    try {
      await processResponse();
    } catch (err) {
      console.log(`${C.red}Error: ${err.message}${C.reset}`);
    }
  }
}

main();
