import {
    App,
    Editor,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    request,
    requestUrl,
    Setting,
} from "obsidian";

interface PollinationsSettings {
    apiKey: string;
    textModel: string;
    imageModel: string;
    imageSize: string;
    imageFolder: string;
}

const DEFAULT_SETTINGS: PollinationsSettings = {
    apiKey: "",
    textModel: "openai",
    imageModel: "flux",
    imageSize: "1024x1024",
    imageFolder: "pollinations",
};

const BASE = "https://gen.pollinations.ai";

class PromptModal extends Modal {
    private result: string | null = null;
    private resolve: ((value: string | null) => void) | null = null;

    constructor(
        app: App,
        private title: string,
        private placeholder: string,
        private initial: string,
    ) {
        super(app);
    }

    open(): Promise<string | null> {
        this.resolve = null;
        return new Promise<string | null>((resolve) => {
            this.resolve = resolve;
            super.open();
        });
    }

    onOpen() {
        this.contentEl.createEl("h3", { text: this.title });
        const textarea = this.contentEl.createEl("textarea", {
            value: this.initial,
            placeholder: this.placeholder,
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
            cls: "mod-cta",
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
        this.resolve?.(this.result);
    }
}

export default class PollinationsPlugin extends Plugin {
    settings: PollinationsSettings = DEFAULT_SETTINGS;

    async onload() {
        await this.loadSettings();

        this.addCommand({
            id: "generate-text",
            name: "Generate text at cursor",
            editorCallback: async (editor: Editor) => {
                const selected = editor.getSelection();
                const prompt = await new PromptModal(
                    this.app,
                    "Generate text (Pollinations)",
                    "Describe what to generate…",
                    selected,
                ).open();
                if (!prompt) return;
                const text = await this.generateText(prompt, selected);
                if (text) {
                    editor.replaceSelection(text);
                }
            },
        });

        this.addCommand({
            id: "generate-image",
            name: "Generate image and embed",
            editorCallback: async (editor: Editor) => {
                const prompt = await new PromptModal(
                    this.app,
                    "Generate image (Pollinations)",
                    "Describe the image…",
                    "",
                ).open();
                if (!prompt) return;
                await this.generateImage(editor, prompt);
            },
        });

        this.addSettingTab(new PollinationsSettingTab(this.app, this));
    }

    private headers(): Record<string, string> {
        return {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.settings.apiKey}`,
        };
    }

    async generateText(prompt: string, context: string): Promise<string> {
        const messages: { role: string; content: string }[] = [];
        if (context) {
            messages.push({
                role: "system",
                content:
                    "Rewrite or expand the user's selection according to the instruction. Return only the result text.",
            });
            messages.push({
                role: "user",
                content: `${prompt}\n\n---\n${context}`,
            });
        } else {
            messages.push({ role: "user", content: prompt });
        }
        try {
            const response = await request({
                url: `${BASE}/v1/chat/completions`,
                method: "POST",
                headers: this.headers(),
                body: JSON.stringify({
                    model: this.settings.textModel,
                    messages,
                }),
            });
            const completion = JSON.parse(response);
            const content = completion.choices?.[0]?.message?.content;
            if (typeof content !== "string" || !content) {
                throw new Error("empty completion");
            }
            return content;
        } catch (error) {
            new Notice(
                `Pollinations: ${String((error as Error).message ?? error)}`,
            );
            return "";
        }
    }

    async generateImage(editor: Editor, prompt: string): Promise<void> {
        new Notice("Pollinations: generating image…");
        try {
            const response = await request({
                url: `${BASE}/v1/images/generations`,
                method: "POST",
                headers: this.headers(),
                body: JSON.stringify({
                    model: this.settings.imageModel,
                    prompt,
                    size: this.settings.imageSize,
                }),
            });
            const result = JSON.parse(response);
            const item = result.data?.[0];
            let bytes: ArrayBuffer | null = null;
            if (item?.b64_json) {
                bytes = this.base64ToArrayBuffer(item.b64_json);
            } else if (item?.url) {
                bytes = await requestUrl({ url: item.url }).arrayBuffer;
            }
            if (!bytes) throw new Error("no image in response");
            const folder = this.settings.imageFolder;
            if (!(await this.app.vault.adapter.exists(folder))) {
                await this.app.vault.createFolder(folder);
            }
            const safeName = prompt
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .slice(0, 40);
            const path = `${folder}/${Date.now()}-${safeName || "image"}.png`;
            const file = await this.app.vault.createBinary(path, bytes);
            editor.replaceSelection(`![[${file.path}]]`);
            new Notice("Pollinations: image saved");
        } catch (error) {
            new Notice(
                `Pollinations: ${String((error as Error).message ?? error)}`,
            );
        }
    }

    private base64ToArrayBuffer(base64: string): ArrayBuffer {
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
            await this.loadData(),
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class PollinationsSettingTab extends PluginSettingTab {
    private plugin: PollinationsPlugin;

    constructor(app: App, plugin: PollinationsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Pollinations" });

        new Setting(containerEl)
            .setName("API key")
            .setDesc(
                "Create at https://enter.pollinations.ai/keys (BYOP: generation costs your Pollen).",
            )
            .addText((text) =>
                text
                    .setPlaceholder("polli_…")
                    .setValue(this.plugin.settings.apiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.apiKey = value.trim();
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("Text model")
            .setDesc("Any model from https://gen.pollinations.ai/text/models")
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.textModel)
                    .onChange(async (value) => {
                        this.plugin.settings.textModel = value.trim();
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("Image model")
            .setDesc("Any model from https://gen.pollinations.ai/image/models")
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.imageModel)
                    .onChange(async (value) => {
                        this.plugin.settings.imageModel = value.trim();
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("Image size")
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.imageSize)
                    .onChange(async (value) => {
                        this.plugin.settings.imageSize = value.trim();
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("Image folder")
            .setDesc("Vault folder for generated images")
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.imageFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.imageFolder = value
                            .trim()
                            .replace(/^\/|\/$/g, "");
                        await this.plugin.saveSettings();
                    }),
            );
    }
}
