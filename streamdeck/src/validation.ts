export type Language = "en" | "ru";
export type ActionKind = "brightness" | "color" | "off" | "on" | "preset";
export type Connection = { port: number; accessToken: string };
export type GlobalSettings = { schemaVersion: 1; connection: Connection | null; language: Language };
export type Assignment = { schemaVersion: 1; rgb?: string; percent?: number; presetId?: string };

export function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function port(value: unknown): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1024 || value > 65535)
		throw new Error("validation");
	return value;
}
export function token(value: unknown): string {
	if (typeof value !== "string" || !/^[A-Za-z0-9_-]{24,128}$/.test(value)) throw new Error("validation");
	return value;
}
export function connection(value: unknown): Connection {
	if (!object(value)) throw new Error("validation");
	return { port: port(value.port), accessToken: token(value.accessToken) };
}
export function language(value: unknown): Language {
	if (value !== "en" && value !== "ru") throw new Error("validation");
	return value;
}
export function globals(value: unknown): GlobalSettings {
	if (object(value) && Object.keys(value).length === 0) return { schemaVersion: 1, connection: null, language: "en" };
	if (!object(value) || value.schemaVersion !== 1) throw new Error("validation");
	return {
		schemaVersion: 1,
		connection: value.connection === null ? null : connection(value.connection),
		language: value.language === undefined ? "en" : language(value.language),
	};
}
export function colorInput(value: unknown): string {
	if (typeof value !== "string" || !/^#?[a-fA-F0-9]{6}$/.test(value)) throw new Error("validation");
	return value.replace(/^#/, "").toUpperCase();
}
export function assignment(kind: ActionKind, value: unknown): Assignment {
	if (!object(value)) throw new Error("validation");
	if (Object.keys(value).length === 0) {
		if (kind === "color") return { schemaVersion: 1, rgb: "FF5000" };
		if (kind === "brightness") return { schemaVersion: 1, percent: 50 };
		return { schemaVersion: 1 };
	}
	if (value.schemaVersion !== 1) throw new Error("validation");
	switch (kind) {
		case "color":
			if (typeof value.rgb !== "string" || !/^[a-fA-F0-9]{6}$/.test(value.rgb)) throw new Error("validation");
			return { schemaVersion: 1, rgb: value.rgb.toUpperCase() };
		case "brightness":
			if (
				typeof value.percent !== "number" ||
				!Number.isInteger(value.percent) ||
				value.percent < 0 ||
				value.percent > 100
			)
				throw new Error("validation");
			return { schemaVersion: 1, percent: value.percent };
		case "preset":
			if (value.presetId === undefined) return { schemaVersion: 1 };
			if (typeof value.presetId !== "string" || !/^[a-z0-9_-]{1,40}$/.test(value.presetId))
				throw new Error("validation");
			return { schemaVersion: 1, presetId: value.presetId };
		default:
			return { schemaVersion: 1 };
	}
}

export function parseConnectionLink(value: unknown): Connection {
	if (typeof value !== "string") throw new Error("validation");
	const raw = value.trim();
	// Match the raw spelling before URL normalization can hide an unsafe route.
	const match =
		/^http:\/\/(localhost|127\.0\.0\.1):([0-9]{1,5})\/([A-Za-z0-9_-]{24,128})\/(on|off|color\/[A-Fa-f0-9]{6}|brightness\/[0-9]{1,3}|preset\/[a-z0-9_-]{1,40})$/i.exec(
			raw,
		);
	if (!match || /[\r\n\\%?#]/.test(raw)) throw new Error("validation");
	const route = match[4]!;
	if (!/^(on|off|color\/[A-Fa-f0-9]{6}|brightness\/[0-9]{1,3}|preset\/[a-z0-9_-]{1,40})$/.test(route))
		throw new Error("validation");
	if (route.startsWith("brightness/") && Number(route.slice(11)) > 100) throw new Error("validation");
	return connection({ port: Number(match[2]), accessToken: match[3] });
}
