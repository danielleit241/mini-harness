import { render } from "ink";
import { validateConfig } from "../core/config.js";
import { App } from "./App.js";

for (const warning of validateConfig(process.env).warnings) {
  console.error(`[config] ${warning}`);
}

render(<App />);
