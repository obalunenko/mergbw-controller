import { object } from "./validation.js";

export type EffectDefinition =
	| { kind: "breathing"; loop: boolean; minBrightness: number; cycleMs: number }
	| { kind: "candle"; loop: boolean; depth: number; flickerMs: number; durationMs?: number }
	| { kind: "palette"; loop: boolean; colors: number[][]; transitionMs: number }
	| { kind: "strobe"; loop: boolean; onMs: number; offMs: number };
export type PresetKind = EffectDefinition["kind"] | "static";
export type PresetDefinition = { label: string; rgb: number[]; brightness: number; effect?: EffectDefinition };
export type EffectSnapshot = {
	id: string;
	presetId: string;
	kind: EffectDefinition["kind"];
	state: "cancelled" | "cancelling" | "completed" | "failed" | "running" | "unknown";
	elapsedMs: number;
	durationMs: number | null;
	physical_state_verified: false;
};
export type EffectEnvelope = { effect: EffectSnapshot | null; physical_state_verified: false };
export type PresetPage = {
	generation: string;
	entries: { id: string; label: string; labelTruncated: boolean; builtIn?: boolean }[];
	nextCursor: string | null;
};
export type PresetRead = { generation: string; id: string; preset: PresetDefinition };
export const presetKinds: PresetKind[] = ["static", "palette", "strobe", "breathing", "candle"];
const integer = (value: unknown, low: number, high: number): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= low && value <= high;
const exact = (value: Record<string, unknown>, keys: string[]): boolean =>
	Object.keys(value).sort().join(",") === keys.sort().join(",");
const color = (value: unknown): value is number[] =>
	Array.isArray(value) && value.length === 3 && value.every((channel) => integer(channel, 0, 255));
export const presetId = (value: unknown): value is string =>
	typeof value === "string" && /^[a-z0-9_-]{1,40}$/.test(value);
export const generationId = (value: unknown): value is string =>
	typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const label = (value: unknown, editing: boolean): value is string =>
	typeof value === "string" &&
	!!value.trim() &&
	[...value].length <= (editing ? 128 : 32768) &&
	![...value].some(
		(c) =>
			c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159) || c === "\u2028" || c === "\u2029",
	);

// Return a fresh validated definition. Never forward untrusted extra fields.
export function presetDefinition(value: unknown, editing = true, secret = ""): PresetDefinition {
	if (
		!object(value) ||
		!exact(
			value,
			value.effect === undefined ? ["label", "rgb", "brightness"] : ["label", "rgb", "brightness", "effect"],
		) ||
		!label(value.label, editing) ||
		(secret && value.label.includes(secret)) ||
		!color(value.rgb) ||
		!integer(value.brightness, 0, 100)
	)
		throw new Error("validation");
	const result: PresetDefinition = { label: value.label, rgb: [...value.rgb], brightness: value.brightness };
	if (value.effect === undefined) return result;
	const e = value.effect;
	if (!object(e) || typeof e.loop !== "boolean") throw new Error("validation");
	let valid = false;
	switch (e.kind) {
		case "palette":
			valid =
				exact(e, ["kind", "loop", "colors", "transitionMs"]) &&
				Array.isArray(e.colors) &&
				e.colors.length >= 1 &&
				e.colors.length <= 15 &&
				e.colors.every(color) &&
				integer(e.transitionMs, 500, 60000);
			break;
		case "strobe":
			valid =
				exact(e, ["kind", "loop", "onMs", "offMs"]) && integer(e.onMs, 250, 60000) && integer(e.offMs, 250, 60000);
			break;
		case "breathing":
			valid =
				exact(e, ["kind", "loop", "minBrightness", "cycleMs"]) &&
				integer(e.minBrightness, 0, 99) &&
				e.minBrightness < result.brightness &&
				integer(e.cycleMs, 1000, 120000);
			break;
		case "candle":
			valid =
				exact(
					e,
					e.loop ? ["kind", "loop", "depth", "flickerMs"] : ["kind", "loop", "depth", "flickerMs", "durationMs"],
				) &&
				integer(e.depth, 0, 100) &&
				integer(e.flickerMs, 250, 5000) &&
				(e.loop || integer(e.durationMs, 1000, 3600000));
			break;
	}
	if (!valid) throw new Error("validation");
	result.effect = structuredClone(e) as EffectDefinition;
	return result;
}

export function defaultPreset(kind: PresetKind = "static"): PresetDefinition {
	const base: PresetDefinition = { label: "", rgb: [255, 80, 0], brightness: 75 };
	switch (kind) {
		case "palette":
			base.effect = {
				kind,
				loop: true,
				colors: [
					[0, 80, 255],
					[160, 0, 255],
				],
				transitionMs: 2000,
			};
			break;
		case "strobe":
			base.rgb = [255, 255, 255];
			base.effect = { kind, loop: true, onMs: 500, offMs: 500 };
			break;
		case "breathing":
			base.effect = { kind, loop: true, minBrightness: 5, cycleMs: 4000 };
			break;
		case "candle":
			base.rgb = [255, 176, 64];
			base.brightness = 65;
			base.effect = { kind, loop: true, depth: 35, flickerMs: 500 };
			break;
	}
	return base;
}

export function effectSnapshot(value: unknown, secret = ""): value is EffectSnapshot {
	if (
		!object(value) ||
		!exact(value, ["id", "presetId", "kind", "state", "elapsedMs", "durationMs", "physical_state_verified"])
	)
		return false;
	return (
		generationId(value.id) &&
		presetId(value.presetId) &&
		!(secret && (value.id.includes(secret) || value.presetId.includes(secret))) &&
		["palette", "strobe", "breathing", "candle"].includes(String(value.kind)) &&
		["running", "cancelling", "completed", "cancelled", "failed", "unknown"].includes(String(value.state)) &&
		integer(value.elapsedMs, 0, Number.MAX_SAFE_INTEGER) &&
		(value.durationMs === null || integer(value.durationMs, 500, 3600000)) &&
		value.physical_state_verified === false
	);
}
