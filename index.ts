import { homedir } from "node:os";

import {
	AgentSession,
	CustomEditor,
	keyText,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	type ToolDefinition as PiToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

const WIDGET_KEY = "pi-hide-tools";
const HIDE_TOOL_WRAPPED = Symbol.for("pi-hide-tools.wrapped");
const SESSION_PATCHED = Symbol.for("pi-hide-tools.session-patched");
const SESSION_ORIGINAL_GET_TOOL_DEFINITION = Symbol.for("pi-hide-tools.original-get-tool-definition");
const SESSION_GET_MODE = Symbol.for("pi-hide-tools.get-mode");

type ToolMode = "hidden" | "compact";
type ToolDefinition = PiToolDefinition<any, any, any>;
type WrappedToolDefinition = ToolDefinition & Record<PropertyKey, unknown>;
type GetToolDefinition = (toolName: string) => ToolDefinition | undefined;
type AgentSessionPrototypeWithPatch = {
	getToolDefinition: GetToolDefinition;
} & Record<PropertyKey, unknown>;
type ToolRenderCall = NonNullable<ToolDefinition["renderCall"]>;
type ToolRenderResult = NonNullable<ToolDefinition["renderResult"]>;
type ToolRenderCallParams = Parameters<ToolRenderCall>;
type ToolRenderResultParams = Parameters<ToolRenderResult>;
type RenderTheme = ToolRenderResultParams[2];

class EmptyRenderComponent {
	invalidate(): void {}
	render(): string[] {
		return [];
	}
}

class SingleLineRenderComponent {
	private lineRenderer: ((width: number) => string) | undefined;

	setLineRenderer(lineRenderer: (width: number) => string): void {
		this.lineRenderer = lineRenderer;
		this.invalidate();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const line = this.lineRenderer?.(width) ?? "";
		return line ? [line] : [];
	}
}

class HideToolsEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		private readonly keybindings: KeybindingsManager,
		private readonly onToggleToolsMode: () => void,
	) {
		super(tui, theme, keybindings);
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "app.tools.expand")) {
			this.onToggleToolsMode();
			return;
		}
		super.handleInput(data);
	}
}

function sanitizeInlineText(text: string): string {
	return text
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/[\r\n\t]+/g, " ")
		.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
}

function str(value: unknown): string | null {
	if (typeof value === "string") return sanitizeInlineText(value);
	if (value == null) return "";
	return null;
}

function asRecord(args: unknown): Record<string, unknown> | undefined {
	return args && typeof args === "object" ? (args as Record<string, unknown>) : undefined;
}

function firstStringArg(args: unknown, names: string[]): string | null {
	const record = asRecord(args);
	if (!record) return "";
	for (const name of names) {
		if (Object.prototype.hasOwnProperty.call(record, name)) {
			return str(record[name]);
		}
	}
	return "";
}

function numberArg(args: unknown, name: string): number | undefined {
	const value = asRecord(args)?.[name];
	return typeof value === "number" ? value : undefined;
}

function shortenPath(path: string): string {
	const home = homedir();
	return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function invalidArgText(): string {
	return "[invalid arg]";
}

function formatPlainPathArg(args: unknown, placeholder = "..."): string {
	const path = firstStringArg(args, ["file_path", "path"]);
	if (path === null) return invalidArgText();
	return path ? shortenPath(path) : placeholder;
}

function formatReadLineRange(args: unknown): string {
	const offset = numberArg(args, "offset");
	const limit = numberArg(args, "limit");
	if (offset === undefined && limit === undefined) return "";
	const startLine = offset ?? 1;
	const endLine = limit !== undefined ? startLine + limit - 1 : "";
	return `:${startLine}${endLine ? `-${endLine}` : ""}`;
}

function formatSearchPath(rawPath: string | null): string {
	return rawPath === null ? invalidArgText() : shortenPath(rawPath || ".");
}

function formatPlainCallLine(toolName: string, args: unknown): string {
	const record = asRecord(args);

	switch (toolName) {
		case "bash": {
			const command = str(record?.command);
			const timeout = numberArg(args, "timeout");
			const commandText = command === null ? invalidArgText() : command || "...";
			return `$ ${commandText}${timeout ? ` (timeout ${timeout}s)` : ""}`;
		}
		case "edit":
		case "write":
			return `${toolName} ${formatPlainPathArg(args)}`;
		case "find": {
			const pattern = str(record?.pattern);
			const rawPath = str(record?.path);
			const limit = numberArg(args, "limit");
			let text = `find ${pattern === null ? invalidArgText() : pattern || ""} in ${formatSearchPath(rawPath)}`;
			if (limit !== undefined) text += ` (limit ${limit})`;
			return text;
		}
		case "grep": {
			const pattern = str(record?.pattern);
			const rawPath = str(record?.path);
			const glob = str(record?.glob);
			const limit = numberArg(args, "limit");
			let text = `grep /${pattern === null ? invalidArgText() : pattern || ""}/ in ${formatSearchPath(rawPath)}`;
			if (glob) text += ` (${glob})`;
			if (glob === null) text += ` ${invalidArgText()}`;
			if (limit !== undefined) text += ` limit ${limit}`;
			return text;
		}
		case "ls": {
			const rawPath = str(record?.path);
			const limit = numberArg(args, "limit");
			let text = `ls ${rawPath === null ? invalidArgText() : shortenPath(rawPath || ".")}`;
			if (limit !== undefined) text += ` (limit ${limit})`;
			return text;
		}
		case "read":
			return `read ${formatPlainPathArg(args)}${formatReadLineRange(args)}`;
		default:
			return toolName;
	}
}

function formatToolTitle(toolName: string, theme: RenderTheme): string {
	return theme.fg("toolTitle", theme.bold(toolName));
}

function formatPathArg(args: unknown, theme: RenderTheme, placeholder = "..."): string {
	const path = firstStringArg(args, ["file_path", "path"]);
	if (path === null) return theme.fg("error", invalidArgText());
	return path ? theme.fg("accent", shortenPath(path)) : theme.fg("toolOutput", placeholder);
}

function formatStyledReadCall(args: unknown, theme: RenderTheme): string {
	const range = formatReadLineRange(args);
	return `${formatToolTitle("read", theme)} ${formatPathArg(args, theme)}${range ? theme.fg("warning", range) : ""}`;
}

function formatStyledBashCall(args: unknown, theme: RenderTheme): string {
	const command = str(asRecord(args)?.command);
	const timeout = numberArg(args, "timeout");
	const commandDisplay = command === null
		? theme.fg("error", invalidArgText())
		: command
			? theme.fg("toolTitle", theme.bold(command))
			: theme.fg("toolOutput", "...");
	return `${theme.fg("toolTitle", theme.bold("$"))} ${commandDisplay}${timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : ""}`;
}

function formatStyledSearchPath(rawPath: string | null, theme: RenderTheme): string {
	return rawPath === null ? theme.fg("error", invalidArgText()) : shortenPath(rawPath || ".");
}

function formatStyledFindCall(args: unknown, theme: RenderTheme): string {
	const pattern = str(asRecord(args)?.pattern);
	const rawPath = str(asRecord(args)?.path);
	const limit = numberArg(args, "limit");
	let text = `${formatToolTitle("find", theme)} ${
		pattern === null ? theme.fg("error", invalidArgText()) : theme.fg("accent", pattern || "")
	}${theme.fg("toolOutput", ` in ${formatStyledSearchPath(rawPath, theme)}`)}`;
	if (limit !== undefined) text += theme.fg("toolOutput", ` (limit ${limit})`);
	return text;
}

function formatStyledGrepCall(args: unknown, theme: RenderTheme): string {
	const pattern = str(asRecord(args)?.pattern);
	const rawPath = str(asRecord(args)?.path);
	const glob = str(asRecord(args)?.glob);
	const limit = numberArg(args, "limit");
	let text = `${formatToolTitle("grep", theme)} ${
		pattern === null ? theme.fg("error", invalidArgText()) : theme.fg("accent", `/${pattern || ""}/`)
	}${theme.fg("toolOutput", ` in ${formatStyledSearchPath(rawPath, theme)}`)}`;
	if (glob) text += theme.fg("toolOutput", ` (${glob})`);
	if (glob === null) text += ` ${theme.fg("error", invalidArgText())}`;
	if (limit !== undefined) text += theme.fg("toolOutput", ` limit ${limit}`);
	return text;
}

function formatStyledLsCall(args: unknown, theme: RenderTheme): string {
	const rawPath = str(asRecord(args)?.path);
	const limit = numberArg(args, "limit");
	let text = `${formatToolTitle("ls", theme)} ${
		rawPath === null ? theme.fg("error", invalidArgText()) : theme.fg("accent", shortenPath(rawPath || "."))
	}`;
	if (limit !== undefined) text += theme.fg("toolOutput", ` (limit ${limit})`);
	return text;
}

function formatStyledPathOnlyCall(toolName: "edit" | "write", args: unknown, theme: RenderTheme): string {
	return `${formatToolTitle(toolName, theme)} ${formatPathArg(args, theme)}`;
}

function formatStyledCallLine(toolName: string, args: unknown, theme: RenderTheme): string {
	switch (toolName) {
		case "bash":
			return formatStyledBashCall(args, theme);
		case "edit":
			return formatStyledPathOnlyCall("edit", args, theme);
		case "find":
			return formatStyledFindCall(args, theme);
		case "grep":
			return formatStyledGrepCall(args, theme);
		case "ls":
			return formatStyledLsCall(args, theme);
		case "read":
			return formatStyledReadCall(args, theme);
		case "write":
			return formatStyledPathOnlyCall("write", args, theme);
		default:
			return formatToolTitle(toolName, theme);
	}
}

function renderHiddenCall(): EmptyRenderComponent {
	return new EmptyRenderComponent();
}

function renderCompactCall(
	toolName: string,
	args: ToolRenderCallParams[0],
	theme: RenderTheme,
	context: ToolRenderCallParams[2],
): SingleLineRenderComponent {
	const component = context.lastComponent instanceof SingleLineRenderComponent
		? context.lastComponent
		: new SingleLineRenderComponent();
	const line = context.isError
		? theme.fg("error", formatPlainCallLine(toolName, args))
		: formatStyledCallLine(toolName, args, theme);
	component.setLineRenderer((width) => truncateToWidth(line, width, "..."));
	return component;
}

function renderEmptyResult(context: ToolRenderResultParams[3]): EmptyRenderComponent {
	return context.lastComponent instanceof EmptyRenderComponent ? context.lastComponent : new EmptyRenderComponent();
}

function isHideToolDefinition(tool: ToolDefinition): boolean {
	return Boolean((tool as WrappedToolDefinition)[HIDE_TOOL_WRAPPED]);
}

function createHideToolDefinition(base: ToolDefinition, getMode: () => ToolMode): ToolDefinition {
	if (isHideToolDefinition(base)) return base;

	const wrapped: WrappedToolDefinition = {
		...base,
		renderShell: "self",
		renderCall(args, theme, context) {
			if (getMode() === "compact") return renderCompactCall(base.name, args, theme, context);
			return renderHiddenCall();
		},
		renderResult(_result, _options, _theme, context) {
			return renderEmptyResult(context);
		},
	};

	Object.defineProperty(wrapped, HIDE_TOOL_WRAPPED, { value: true });
	return wrapped;
}

function installToolRendererPatch(getMode: () => ToolMode): void {
	const prototype = AgentSession.prototype as unknown as AgentSessionPrototypeWithPatch;
	prototype[SESSION_GET_MODE] = getMode;

	if (prototype[SESSION_PATCHED]) return;

	const originalGetToolDefinition = prototype.getToolDefinition;
	prototype[SESSION_ORIGINAL_GET_TOOL_DEFINITION] = originalGetToolDefinition;
	prototype.getToolDefinition = function getToolDefinitionWithHiddenRenderers(this: AgentSessionPrototypeWithPatch, toolName: string) {
		const original = prototype[SESSION_ORIGINAL_GET_TOOL_DEFINITION] as GetToolDefinition;
		const definition = original.call(this, toolName);
		if (!definition) return definition;
		const modeGetter = (prototype[SESSION_GET_MODE] as (() => ToolMode) | undefined) ?? (() => "hidden");
		return createHideToolDefinition(definition, modeGetter);
	};
	prototype[SESSION_PATCHED] = true;
}

function nextMode(mode: ToolMode): ToolMode {
	return mode === "hidden" ? "compact" : "hidden";
}

function widgetLine(ctx: ExtensionContext, mode: ToolMode): string {
	const shortcut = keyText("app.tools.expand");
	const label = `tools: ${mode}(${shortcut})`;
	const color = mode === "hidden" ? "muted" : "accent";
	return ctx.ui.theme.fg(color, label);
}

function updateWidget(ctx: ExtensionContext, mode: ToolMode): void {
	ctx.ui.setWidget(WIDGET_KEY, [widgetLine(ctx, mode)]);
}

export default function piHideToolsExtension(pi: ExtensionAPI) {
	let mode: ToolMode = "hidden";
	installToolRendererPatch(() => mode);

	function applyMode(ctx: ExtensionContext): void {
		// 表示済みのツールを新しいモードで描き直させる唯一の公開APIがこれ。
		// compact時はtrueにして、compaction要約などの組み込み折りたたみも一緒に開く。
		ctx.ui.setToolsExpanded(mode === "compact");
		// setToolsExpandedが出す「Tool output: collapsed/expanded」を空文字で上書きして消す
		ctx.ui.notify("");
		updateWidget(ctx, mode);
	}

	function cycleMode(ctx: ExtensionContext): void {
		mode = nextMode(mode);
		applyMode(ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		mode = "hidden";
		if (ctx.hasUI) {
			applyMode(ctx);
		}
		if (ctx.mode === "tui") {
			ctx.ui.setEditorComponent((tui, theme, keybindings) => new HideToolsEditor(tui, theme, keybindings, () => cycleMode(ctx)));
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		if (ctx.mode === "tui") {
			ctx.ui.setEditorComponent(undefined);
		}
	});
}
