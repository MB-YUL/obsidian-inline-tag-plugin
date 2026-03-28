import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	FuzzySuggestModal,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";
import {
	ViewPlugin,
	ViewUpdate,
	Decoration,
	DecorationSet,
	WidgetType,
	EditorView,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

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
	enableLivePreviewDecorations: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	showCanonicalTagOnHover: true,
	styleMode: "link",
	debugLogging: false,
	enableLivePreviewDecorations: true,
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
	const cls =
		"hybrid-tag-link" +
		(settings.styleMode === "tag" ? " hybrid-tag-link--tag" : "");
	const span = createSpan({ cls, text: token.label, attr: { "data-tag": token.tag } });
	if (settings.showCanonicalTagOnHover) {
		span.title = buildSearchQuery(token.tag);
	}
	return span;
}

/**
 * Walk text nodes inside `el`, find token matches, and replace them with
 * rendered span elements. Uses Obsidian DOM helpers (no innerHTML).
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

		const frag = createFragment();
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
				console.debug("[inline-tag] rendered", token);
			}
		}

		// Remaining text after last match.
		if (cursor < text.length) {
			frag.appendChild(document.createTextNode(text.slice(cursor)));
		}

		textNode.replaceWith(frag);
	}
}

// ── Live Preview (CodeMirror 6) ───────────────────────────────────────────────

class HybridTagWidget extends WidgetType {
	constructor(
		private readonly tag: string,
		private readonly label: string,
		private readonly settings: PluginSettings,
	) {
		super();
	}

	eq(other: HybridTagWidget): boolean {
		return (
			other.tag === this.tag &&
			other.label === this.label &&
			other.settings.styleMode === this.settings.styleMode &&
			other.settings.showCanonicalTagOnHover === this.settings.showCanonicalTagOnHover
		);
	}

	toDOM(_view: EditorView): HTMLElement {
		const token: HybridTagToken = {
			raw: `[[#${this.tag}|${this.label}]]`,
			tag: this.tag,
			label: this.label,
		};
		return createHybridElement(token, this.settings);
	}

	ignoreEvent(_event: Event): boolean {
		// Let clicks propagate to the document-level delegated handler.
		return false;
	}
}

function buildDecorations(view: EditorView, settings: PluginSettings): DecorationSet {
	if (!settings.enableLivePreviewDecorations) {
		return Decoration.none;
	}

	const builder = new RangeSetBuilder<Decoration>();
	const cursorRanges = view.state.selection.ranges;

	for (const { from, to } of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to);

		TOKEN_REGEX.lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = TOKEN_REGEX.exec(text)) !== null) {
			const tokenStart = from + match.index;
			const tokenEnd   = tokenStart + match[0].length;

			// Reveal raw syntax when the cursor is inside the token.
			const cursorInside = cursorRanges.some(
				(r) => r.from <= tokenEnd && r.to >= tokenStart,
			);
			if (cursorInside) continue;

			const token = parseHybridTagToken(match[0]);
			if (!token) continue;

			builder.add(
				tokenStart,
				tokenEnd,
				Decoration.replace({
					widget: new HybridTagWidget(token.tag, token.label, settings),
				}),
			);
		}
	}

	return builder.finish();
}

function createHybridTagViewPlugin(settings: PluginSettings) {
	return ViewPlugin.define(
		(view: EditorView) => ({
			decorations: buildDecorations(view, settings),
			update(update: ViewUpdate) {
				if (update.docChanged || update.selectionSet || update.viewportChanged) {
					this.decorations = buildDecorations(update.view, settings);
				}
			},
		}),
		{ decorations: (v) => v.decorations },
	);
}

// ── Tag autocomplete (EditorSuggest) ─────────────────────────────────────────

function getVaultTags(app: App): string[] {
	// getTags() exists at runtime but is absent from the shipped type definitions.
	const cache = app.metadataCache as unknown as { getTags(): Record<string, number> };
	return Object.keys(cache.getTags())
		.map((t) => t.slice(1))
		.sort();
}

class TagEditorSuggest extends EditorSuggest<string> {
	private tags: string[] = [];
	private tagsLower: string[] = [];

	constructor(app: App, private plugin: HybridTagLinkPlugin) {
		super(app);
		this.refreshCache();
		// Keep the cache in sync as the vault index updates.
		plugin.registerEvent(app.metadataCache.on("resolved", () => this.refreshCache()));
	}

	private refreshCache(): void {
		this.tags = getVaultTags(this.app);
		this.tagsLower = this.tags.map((t) => t.toLowerCase());
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		const textBefore = line.slice(0, cursor.ch);
		const match = textBefore.match(/\[\[#([^\s|\]]*)$/);
		if (!match) return null;
		return {
			start: { line: cursor.line, ch: cursor.ch - match[1].length },
			end: cursor,
			query: match[1],
		};
	}

	getSuggestions(context: EditorSuggestContext): string[] {
		const query = context.query.toLowerCase();
		return this.tags.filter((_, i) => this.tagsLower[i].includes(query));
	}

	renderSuggestion(tag: string, el: HTMLElement): void {
		el.setText("#" + tag);
	}

	selectSuggestion(tag: string, _evt: MouseEvent | KeyboardEvent): void {
		if (!this.context) return;
		const { editor, start, end } = this.context;
		const prefix = `[[#${tag}|`;
		const insertFrom: EditorPosition = { line: start.line, ch: start.ch - "[[#".length };
		editor.replaceRange(`${prefix}]]`, insertFrom, end);
		editor.setCursor({ line: start.line, ch: insertFrom.ch + prefix.length });

		if (this.plugin.settings.debugLogging) {
			console.debug("[inline-tag] autocomplete selected:", tag);
		}
	}
}

// ── Tag picker modal (for right-click wrapping) ───────────────────────────────

class TagPickerModal extends FuzzySuggestModal<string> {
	private readonly tags: string[];

	constructor(app: App, private onSelect: (tag: string) => void) {
		super(app);
		this.setPlaceholder("Search tags…");
		this.tags = getVaultTags(app);
	}

	getItems(): string[] {
		return this.tags;
	}

	getItemText(tag: string): string {
		return tag;
	}

	onChooseItem(tag: string, _evt: MouseEvent | KeyboardEvent): void {
		this.onSelect(tag);
	}
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export default class HybridTagLinkPlugin extends Plugin {
	settings!: PluginSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Live Preview decorations (CodeMirror 6).
		this.registerEditorExtension(createHybridTagViewPlugin(this.settings));

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
					console.debug("[inline-tag] intercepted link →", token);
				}
			});

			// Also handle any raw text tokens Obsidian left unparsed.
			el.querySelectorAll("p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote").forEach(
				(node) => processNode(node as HTMLElement, this.settings, this.settings.debugLogging)
			);
		});

		// Delegated click handler for all rendered hybrid tokens.
		// registerDomEvent ensures automatic cleanup on plugin unload.
		this.registerDomEvent(document, "click", (e: MouseEvent) => {
			const target = (e.target as HTMLElement).closest<HTMLElement>(".hybrid-tag-link");
			if (!target?.dataset.tag) return;
			e.preventDefault();

			const query = buildSearchQuery(target.dataset.tag);

			if (this.settings.debugLogging) {
				console.debug("[inline-tag] search query:", query);
			}

			// Use Obsidian's internal global-search plugin to open the search pane.
			// Accessing undocumented runtime properties via unknown cast.
			const appAny = this.app as unknown as {
				internalPlugins: {
					getPluginById: (id: string) => {
						instance?: { openGlobalSearch?: (q: string) => void };
					} | null;
				};
				commands: { executeCommandById: (id: string) => void };
			};
			const search = appAny.internalPlugins?.getPluginById("global-search");

			if (search?.instance?.openGlobalSearch) {
				search.instance.openGlobalSearch(query);
			} else {
				appAny.commands.executeCommandById("global-search:open");
			}
		});

		this.registerEditorSuggest(new TagEditorSuggest(this.app, this));

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => {
				const selection = editor.getSelection();
				if (!selection) return;
				menu.addItem((item) =>
					item
						.setTitle("Wrap as inline tag")
						.setIcon("tag")
						.onClick(() => {
							new TagPickerModal(this.app, (tag) => {
								editor.replaceSelection(`[[#${tag}|${selection}]]`);
							}).open();
						})
				);
			})
		);

		this.addSettingTab(new HybridTagLinkSettingTab(this.app, this));
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
			.setName("Live preview decorations")
			.setDesc("Render [[#tag|label]] tokens as styled labels in live preview. The cursor reveals the raw syntax when placed inside a token.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableLivePreviewDecorations)
					.onChange(async (value) => {
						this.plugin.settings.enableLivePreviewDecorations = value;
						await this.plugin.saveSettings();
						this.app.workspace.updateOptions();
					})
			);

		new Setting(containerEl)
			.setName("Show canonical tag on hover")
			.setDesc("Display the tag query (for example, tag:#example) as a tooltip on hover.")
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
