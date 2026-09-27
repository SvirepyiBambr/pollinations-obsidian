"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PollinationsPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  apiKey: "",
  textModel: "openai",
  imageModel: "flux",
  imageSize: "1024x1024",
  imageFolder: "pollinations"
};
var BASE = "https://gen.pollinations.ai";
var PromptModal = class extends import_obsidian.Modal {
  constructor(app, title, placeholder, initial) {
    super(app);
    this.title = title;
    this.placeholder = placeholder;
    this.initial = initial;
    this.result = null;
    this.resolve = null;
  }
  open() {
    this.resolve = null;
    return new Promise((resolve) => {
      this.resolve = resolve;
      super.open();
    });
  }
  onOpen() {
    this.contentEl.createEl("h3", { text: this.title });
    const textarea = this.contentEl.createEl("textarea", {
      value: this.initial,
      placeholder: this.placeholder
    });
    textarea.style.width = "100%";
    textarea.style.minHeight = "80px";
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.ctrlKey) {
        this.result = textarea.value.trim() || null;
        this.close();
      }
    });
    const buttons = this.contentEl.createDiv();
    const submit = buttons.createEl("button", {
      text: "Generate",
      cls: "mod-cta"
    });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    submit.addEventListener("click", () => {
      this.result = textarea.value.trim() || null;
      this.close();
    });
    cancel.addEventListener("click", () => {
      this.result = null;
      this.close();
    });
  }
  onClose() {
    var _a;
    (_a = this.resolve) == null ? void 0 : _a.call(this, this.result);
  }
};
var PollinationsPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
  }
  async onload() {
    await this.loadSettings();
    this.addCommand({
      id: "generate-text",
      name: "Generate text at cursor",
      editorCallback: async (editor) => {
        const selected = editor.getSelection();
        const prompt = await new PromptModal(
          this.app,
          "Generate text (Pollinations)",
          "Describe what to generate\u2026",
          selected
        ).open();
        if (!prompt) return;
        const text = await this.generateText(prompt, selected);
        if (text) {
          editor.replaceSelection(text);
        }
      }
    });
    this.addCommand({
      id: "generate-image",
      name: "Generate image and embed",
      editorCallback: async (editor) => {
        const prompt = await new PromptModal(
          this.app,
          "Generate image (Pollinations)",
          "Describe the image\u2026",
          ""
        ).open();
        if (!prompt) return;
        await this.generateImage(editor, prompt);
      }
    });
    this.addSettingTab(new PollinationsSettingTab(this.app, this));
  }
  headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.settings.apiKey}`
    };
  }
  async generateText(prompt, context) {
    var _a, _b, _c, _d;
    const messages = [];
    if (context) {
      messages.push({
        role: "system",
        content: "Rewrite or expand the user's selection according to the instruction. Return only the result text."
      });
      messages.push({
        role: "user",
        content: `${prompt}

---
${context}`
      });
    } else {
      messages.push({ role: "user", content: prompt });
    }
    try {
      const response = await (0, import_obsidian.request)({
        url: `${BASE}/v1/chat/completions`,
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.settings.textModel,
          messages
        })
      });
      const completion = JSON.parse(response);
      const content = (_c = (_b = (_a = completion.choices) == null ? void 0 : _a[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content;
      if (typeof content !== "string" || !content) {
        throw new Error("empty completion");
      }
      return content;
    } catch (error) {
      new import_obsidian.Notice(
        `Pollinations: ${String((_d = error.message) != null ? _d : error)}`
      );
      return "";
    }
  }
  async generateImage(editor, prompt) {
    var _a, _b;
    new import_obsidian.Notice("Pollinations: generating image\u2026");
    try {
      const response = await (0, import_obsidian.request)({
        url: `${BASE}/v1/images/generations`,
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.settings.imageModel,
          prompt,
          size: this.settings.imageSize
        })
      });
      const result = JSON.parse(response);
      const item = (_a = result.data) == null ? void 0 : _a[0];
      let bytes = null;
      if (item == null ? void 0 : item.b64_json) {
        bytes = this.base64ToArrayBuffer(item.b64_json);
      } else if (item == null ? void 0 : item.url) {
        bytes = await (0, import_obsidian.requestUrl)({ url: item.url }).arrayBuffer;
      }
      if (!bytes) throw new Error("no image in response");
      const folder = this.settings.imageFolder;
      if (!await this.app.vault.adapter.exists(folder)) {
        await this.app.vault.createFolder(folder);
      }
      const safeName = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
      const path = `${folder}/${Date.now()}-${safeName || "image"}.png`;
      const file = await this.app.vault.createBinary(path, bytes);
      editor.replaceSelection(`![[${file.path}]]`);
      new import_obsidian.Notice("Pollinations: image saved");
    } catch (error) {
      new import_obsidian.Notice(
        `Pollinations: ${String((_b = error.message) != null ? _b : error)}`
      );
    }
  }
  base64ToArrayBuffer(base64) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var PollinationsSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Pollinations" });
    new import_obsidian.Setting(containerEl).setName("API key").setDesc(
      "Create at https://enter.pollinations.ai/keys (BYOP: generation costs your Pollen)."
    ).addText(
      (text) => text.setPlaceholder("polli_\u2026").setValue(this.plugin.settings.apiKey).onChange(async (value) => {
        this.plugin.settings.apiKey = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Text model").setDesc("Any model from https://gen.pollinations.ai/text/models").addText(
      (text) => text.setValue(this.plugin.settings.textModel).onChange(async (value) => {
        this.plugin.settings.textModel = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Image model").setDesc("Any model from https://gen.pollinations.ai/image/models").addText(
      (text) => text.setValue(this.plugin.settings.imageModel).onChange(async (value) => {
        this.plugin.settings.imageModel = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Image size").addText(
      (text) => text.setValue(this.plugin.settings.imageSize).onChange(async (value) => {
        this.plugin.settings.imageSize = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Image folder").setDesc("Vault folder for generated images").addText(
      (text) => text.setValue(this.plugin.settings.imageFolder).onChange(async (value) => {
        this.plugin.settings.imageFolder = value.trim().replace(/^\/|\/$/g, "");
        await this.plugin.saveSettings();
      })
    );
  }
};
