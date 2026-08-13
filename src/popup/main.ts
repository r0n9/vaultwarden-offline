import { mount } from "svelte";

import App from "./App.svelte";
import "./app.css";

const target = document.getElementById("app");
if (target == null) {
  throw new Error("popup 挂载点 #app 不存在");
}

export default mount(App, { target });
