import { App, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";

// ── Types ────────────────────────────────────────────────────────────────────

interface HybridTagToken {
	raw: string;
	tag: string;   // without leading '#'
	label: string;
}

interface PluginSettings {
	showCanonicalTagOnHover: boolean;
	styleMode: "link" | "tag";
	debugLogging: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	showCanonicalTagOnHover: true,
	styleMode: "link",
	debugLogging: false,
};

// ── Parser ───────────────────────────────────────────────────────────────────

// Matches [[#TAG|LABEL]] where TAG has no spaces and LABEL is non-empty.
const TOKEN_REGEX = /\[\[#([^\s|\]]+)\|([^\]]+)\]\]/g;

function parseHybridTagToken(raw: string): HybridTagToken | null {
	const m = raw.match(/^\[\[#([^\s|\]]+)\|([^\]]+)\]\]$/);
	if (!m) return null;
	const tag = m[1].trim();
	const label = m[2].trim();
	if (!tag || !label) return null;
	return { raw, tag, label };
}

function buildSearchQuery(tag: string): string {
	// Find notes with the native Obsidian tag OR notes that reference it
	// via our hybrid syntax [[#tag|Label]], so both usages appear in results.
	return `(tag:#${tag} OR "[[#${tag}|")`;
}

/**
 * Approximate Obsidian heading-to-anchor slugification:
 * lowercase, replace spaces with hyphens.
 * Used to detect whether [[#fragment]] refers to a real heading.
 */
function slugifyHeading(heading: string): string {
	return heading.toLowerCase().replace(/\s+/g, "-");
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function createHybridElement(token: HybridTagToken, settings: PluginSettings): HTMLElement {
	const span = document.createElement("span");
	span.className =
		"hybrid-tag-link" +
		(settings.styleMode === "tag" ? " hybrid-tag-link--tag" : "");
	span.textContent = token.label;
	span.dataset.tag = token.tag;
	if (settings.showCanonicalTagOnHover) {
		span.title = buildSearchQuery(token.tag);
	}
	return span;
}

/**
 * Walk text nodes inside `el`, find token matches, and replace them with
 * rendered span elements. Uses safe DOM APIs (no innerHTML).
 */
function processNode(el: HTMLElement, settings: PluginSettings, debug: boolean): void {
	// Collect text nodes first to avoid mutating the tree while walking it.
	const textNodes: Text[] = [];
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	let node: Node | null;
	while ((node = walker.nextNode())) {
		textNodes.push(node as Text);
	}

	for (const textNode of textNodes) {
		const text = textNode.nodeValue ?? "";
		if (!text.includes("[[#")) continue;

		TOKEN_REGEX.lastIndex = 0;
		const matches: RegExpExecArray[] = [];
		let m: RegExpExecArray | null;
		while ((m = TOKEN_REGEX.exec(text)) !== null) {
			matches.push(m);
		}
		if (matches.length === 0) continue;

		const frag = document.createDocumentFragment();
		let cursor = 0;

		for (const match of matches) {
			const token = parseHybridTagToken(match[0]);

			// Text before this match (always, regardless of parse result).
			if (match.index > cursor) {
				frag.appendChild(document.createTextNode(text.slice(cursor, match.index)));
			}

			if (!token) {
				// Invalid token — emit its raw text and advance cursor past it.
				frag.appendChild(document.createTextNode(match[0]));
				cursor = match.index + match[0].length;
				continue;
			}

			frag.appendChild(createHybridElement(token, settings));
			cursor = match.index + match[0].length;

			if (debug) {
				console.log("[hybrid-tag-link] rendered", token);
			}
		}

		// Remaining text after last match.
		if (cursor < text.length) {
			frag.appendChild(document.createTextNode(text.slice(cursor)));
		}

		textNode.replaceWith(frag);
	}
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export default class HybridTagLinkPlugin extends Plugin {
	settings!: PluginSettings;
	private clickHandler!: (e: MouseEvent) => void;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Reading view post-processor.
		this.registerMarkdownPostProcessor((el, ctx) => {
			// Obsidian's own wikilink parser converts [[#tag|Label]] into an
			// <a class="internal-link" data-href="#tag"> before the post-processor
			// runs. We intercept those links and replace them with hybrid tag spans,
			// but only when the target fragment is NOT a real heading in the note.
			const abstractFile = ctx.sourcePath
				? this.app.vault.getAbstractFileByPath(ctx.sourcePath)
				: null;
			const cache =
				abstractFile instanceof TFile
					? this.app.metadataCache.getFileCache(abstractFile)
					: null;
			const existingSlugs = new Set(
				(cache?.headings ?? []).map((h) => slugifyHeading(h.heading))
			);

			el.querySelectorAll("a.internal-link[data-href^='#']").forEach((anchor) => {
				const a = anchor as HTMLAnchorElement;
				const href = a.dataset.href ?? "";
				const tag = href.slice(1); // strip leading '#'
				const label = a.textContent ?? "";

				if (!tag || !label) return;
				// Leave genuine heading links alone.
				if (existingSlugs.has(tag.toLowerCase())) return;

				const token: HybridTagToken = { raw: `[[#${tag}|${label}]]`, tag, label };
				a.replaceWith(createHybridElement(token, this.settings));

				if (this.settings.debugLogging) {
					console.log("[hybrid-tag-link] intercepted link →", token);
				}
			});

			// Also handle any raw text tokens Obsidian left unparsed.
			el.querySelectorAll("p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote").forEach(
				(node) => processNode(node as HTMLElement, this.settings, this.settings.debugLogging)
			);
		});

		// Delegated click handler for all rendered hybrid tokens.
		this.clickHandler = (e: MouseEvent) => {
			const target = (e.target as HTMLElement).closest(".hybrid-tag-link") as HTMLElement | null;
			if (!target?.dataset.tag) return;
			e.preventDefault();

			const query = buildSearchQuery(target.dataset.tag);

			if (this.settings.debugLogging) {
				console.log("[hybrid-tag-link] search query:", query);
			}

			// Use Obsidian's internal global-search plugin to open the search pane.
			const search = (this.app as App & {
				internalPlugins: {
					getPluginById: (id: string) => {
						instance?: { openGlobalSearch?: (q: string) => void };
					} | null;
				};
			}).internalPlugins?.getPluginById("global-search");

			if (search?.instance?.openGlobalSearch) {
				search.instance.openGlobalSearch(query);
			} else {
				// Fallback: execute the built-in search command then set query via
				// the search leaf if available.
				this.app.commands.executeCommandById("global-search:open");
			}
		};

		document.addEventListener("click", this.clickHandler);

		this.addSettingTab(new HybridTagLinkSettingTab(this.app, this));
	}

	onunload(): void {
		document.removeEventListener("click", this.clickHandler);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

// ── Settings tab ─────────────────────────────────────────────────────────────

class HybridTagLinkSettingTab extends PluginSettingTab {
	plugin: HybridTagLinkPlugin;

	constructor(app: App, plugin: HybridTagLinkPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Show canonical tag on hover")
			.setDesc("Display the tag query (e.g. tag:#example) as a tooltip on hover.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showCanonicalTagOnHover)
					.onChange(async (value) => {
						this.plugin.settings.showCanonicalTagOnHover = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Style mode")
			.setDesc("Render hybrid tags as links or as Obsidian-style tag pills.")
			.addDropdown((drop) =>
				drop
					.addOption("link", "Link")
					.addOption("tag", "Tag pill")
					.setValue(this.plugin.settings.styleMode)
					.onChange(async (value) => {
						this.plugin.settings.styleMode = value as "link" | "tag";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Debug logging")
			.setDesc("Log token parsing and search queries to the browser console.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debugLogging)
					.onChange(async (value) => {
						this.plugin.settings.debugLogging = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
