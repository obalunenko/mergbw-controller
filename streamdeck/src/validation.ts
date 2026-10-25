import { SCENE_ROUTE_SOURCE, sceneSelector } from "./scenes.js";

export type Language = "en" | "ru";
export type ActionKind = "brightness" | "color" | "off" | "on" | "preset" | "scene" | "transition";
export type Connection = { port: number; accessToken: string };
export type UpdateSettings = { autoCheck: boolean; notifiedVersion?: string };
export type GlobalSettings = {
	schemaVersion: 1 | 2;
	connection?: Connection | null;
	language: Language;
	updates?: UpdateSettings;
};
export const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export type Assignment = {
	schemaVersion: 1;
	rgb?: string;
	percent?: number;
	presetId?: string;
	sceneId?: string;
	fromRGB?: string;
	fromPercent?: number;
	toRGB?: string;
	toPercent?: number;
	durationSeconds?: number;
};

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
export function updateSettings(value: unknown): UpdateSettings {
	if (!object(value) || typeof value.autoCheck !== "boolean") throw new Error("validation");
	if (Object.keys(value).some((k) => !["autoCheck", "notifiedVersion"].includes(k))) throw new Error("validation");
	if (value.notifiedVersion === undefined) return { autoCheck: value.autoCheck };
	if (typeof value.notifiedVersion !== "string" || !STABLE_TAG.test(value.notifiedVersion))
		throw new Error("validation");
	return { autoCheck: value.autoCheck, notifiedVersion: value.notifiedVersion };
}
export function globals(value: unknown): GlobalSettings {
	if (object(value) && Object.keys(value).length === 0) return { schemaVersion: 2, language: "en" };
	if (!object(value)) throw new Error("validation");
	if (value.schemaVersion === 2) {
		if (Object.keys(value).some((k) => !["schemaVersion", "language", "updates"].includes(k)))
			throw new Error("validation");
		const next: GlobalSettings = { schemaVersion: 2, language: language(value.language) };
		if (value.updates !== undefined) next.updates = updateSettings(value.updates);
		return next;
	}
	if (value.schemaVersion !== 1) throw new Error("validation");
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
		if (kind === "transition")
			return {
				schemaVersion: 1,
				fromRGB: "FF5000",
				fromPercent: 100,
				toRGB: "FF5000",
				toPercent: 0,
				durationSeconds: 30,
			};
		if (kind === "color") return { schemaVersion: 1, rgb: "FF5000" };
		if (kind === "brightness") return { schemaVersion: 1, percent: 50 };
		if (kind === "scene") return { schemaVersion: 1, sceneId: "disco" };
		return { schemaVersion: 1 };
	}
	if (value.schemaVersion !== 1) throw new Error("validation");
	switch (kind) {
		case "transition": {
			if (
				typeof value.fromRGB !== "string" ||
				!/^[a-fA-F0-9]{6}$/.test(value.fromRGB) ||
				typeof value.toRGB !== "string" ||
				!/^[a-fA-F0-9]{6}$/.test(value.toRGB)
			)
				throw new Error("validation");
			for (const key of ["fromPercent", "toPercent", "durationSeconds"] as const) {
				const field = value[key];
				if (
					typeof field !== "number" ||
					!Number.isInteger(field) ||
					field < (key === "durationSeconds" ? 1 : 0) ||
					field > (key === "durationSeconds" ? 60 : 100)
				)
					throw new Error("validation");
			}
			return {
				schemaVersion: 1,
				fromRGB: value.fromRGB.toUpperCase(),
				fromPercent: value.fromPercent as number,
				toRGB: value.toRGB.toUpperCase(),
				toPercent: value.toPercent as number,
				durationSeconds: value.durationSeconds as number,
			};
		}
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
		case "scene": {
			const sceneId = typeof value.sceneId === "string" ? sceneSelector(value.sceneId) : undefined;
			if (sceneId === undefined) throw new Error("validation");
			return { schemaVersion: 1, sceneId };
		}
		default:
			return { schemaVersion: 1 };
	}
}

const linkRoutes = `on|off|color\\/[A-Fa-f0-9]{6}|brightness\\/[0-9]{1,3}|preset\\/[a-z0-9_-]{1,40}|${SCENE_ROUTE_SOURCE}`;
const linkPattern = new RegExp(
	`^http:\\/\\/(localhost|127\\.0\\.0\\.1):([0-9]{1,5})\\/([A-Za-z0-9_-]{24,128})\\/(${linkRoutes})$`,
	"i",
);
const routePattern = new RegExp(`^(${linkRoutes})$`);

export function parseConnectionLink(value: unknown): Connection {
	if (typeof value !== "string") throw new Error("validation");
	const raw = value.trim();
	// Match the raw spelling before URL normalization can hide an unsafe route.
	const match = linkPattern.exec(raw);
	if (!match || /[\r\n\\%?#]/.test(raw)) throw new Error("validation");
	const route = match[4]!;
	if (!routePattern.test(route)) throw new Error("validation");
	if (route.startsWith("brightness/") && Number(route.slice(11)) > 100) throw new Error("validation");
	if (route.startsWith("scene/") && sceneSelector(route.slice("scene/".length)) === undefined)
		throw new Error("validation");
	return connection({ port: Number(match[2]), accessToken: match[3] });
}

export function identity(value: unknown): string {
	if (typeof value !== "string" || !/^(?:[a-fA-F0-9]{2}:){5}[a-fA-F0-9]{2}$/.test(value.trim()))
		throw new Error("invalid_identity");
	return value.trim().toUpperCase();
}

// File paths travel only on the transient private setup channel, never settings.
export function selectedPath(value: unknown): string {
	if (
		typeof value !== "string" ||
		!value.startsWith("/") ||
		new TextEncoder().encode(value).length > 4096 ||
		value.includes("\0")
	)
		throw new Error("import_file");
	return value;
}
