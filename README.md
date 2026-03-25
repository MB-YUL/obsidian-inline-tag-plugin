# Inline Tag Link — Obsidian Plugin

> Write tag references with display labels. Click to search.

[![GitHub release](https://img.shields.io/github/v/release/your-username/obsidian-inline-tag-link)](https://github.com/your-username/obsidian-inline-tag-link/releases)
[![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22inline-tag-link%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-stats%2FHEAD%2Fcommunity-plugin-stats.json)](https://obsidian.md/plugins?id=inline-tag-link)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What it does

Obsidian tags are powerful, but there's no built-in way to reference a tag inline with a human-readable label. This plugin introduces a simple syntax that bridges tags and wikilinks:

```
[[#tag-name|Display Label]]
```

In **Reading view**, this renders as a clickable label. Clicking it opens Obsidian Search pre-loaded with `tag:#tag-name`, showing every note associated with that tag — including notes that reference it via this syntax.

### Before / After

| Source | Reading view |
|--------|-------------|
| `Je travaille sur [[#info-sols\|Info-Sols]].` | Je travaille sur **Info-Sols**. *(clickable)* |
| `See [[#work/dev\|Web Development]] tasks.` | See **Web Development** tasks. *(clickable)* |

---

## Syntax

```
[[#TAG|LABEL]]
```

| Part | Rules |
|------|-------|
| `TAG` | Required. No spaces. Letters, digits, `-`, `_`, `/`, Unicode. |
| `LABEL` | Required. Spaces and Unicode allowed. |

### Valid

```
[[#info-sols|Info-Sols]]
[[#work/dev|Web Development]]
[[#ui-ux|UI/UX]]
[[#réunion|Réunion d'équipe]]
```

### Invalid (left as raw text)

```
[[#tag with spaces|Label]]   ← space in tag
[[#tag]]                     ← missing label
[[tag|Label]]                ← missing leading #
[[#|Label]]                  ← empty tag
[[#tag|]]                    ← empty label
```

---

## Installation

### From Obsidian Community Plugins *(recommended)*

1. Open **Settings → Community plugins**
2. Disable Safe mode if prompted
3. Click **Browse** and search for `Inline Tag Link`
4. Install and enable

### Manual

1. Download the latest release from [GitHub Releases](https://github.com/your-username/obsidian-inline-tag-link/releases)
2. Extract into your vault's `.obsidian/plugins/inline-tag-link/` folder
3. Enable the plugin in **Settings → Community plugins**

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Show canonical tag on hover | On | Tooltip shows `tag:#name` on hover |
| Style mode | Link | `Link` = styled like a wikilink · `Tag pill` = styled like a native tag |
| Debug logging | Off | Logs to DevTools console (Ctrl+Shift+I) |

---

## How search works

Clicking a rendered label opens Obsidian Search with:

```
(tag:#tag-name OR "[[#tag-name|")
```

This finds:
- Notes with a native `#tag-name` Obsidian tag
- Notes that reference the tag using this plugin's syntax

Both usages are discoverable from a single click.

---

## Known limitations

- **Live Preview** is not decorated — the raw syntax is visible in the editor. Reading view is fully supported.
- No autocomplete while typing tokens.
- No hover preview of matching notes.
- No tag rename / refactor tooling.
- Mobile is untested (`isDesktopOnly: true`).

---

## Contributing

Issues and PRs are welcome on [GitHub](https://github.com/your-username/obsidian-inline-tag-link).

To build locally:

```sh
git clone https://github.com/your-username/obsidian-inline-tag-link
cd obsidian-inline-tag-link
npm install
npm run dev      # watch mode
npm run build    # production build
```

Copy the output (`main.js`, `manifest.json`, `styles.css`) into your vault's plugin folder.

---

## Support

If this plugin saves you time, a coffee is always appreciated ☕

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-%23FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/your-username)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-%23FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/your-username)

---

## License

[MIT](LICENSE) © your-username
