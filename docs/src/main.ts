import { mount } from "svelte";
import "@correlaid/cdl-design/tokens.css";
import "@correlaid/cdl-design/fonts.css";
import "@correlaid/cdl-design/typography.css";
import "./styles.css";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("#app not found");
mount(App, { target });
