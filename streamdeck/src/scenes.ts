// Mirror of specs/009-full-command-scene-support/contracts/scenes.md; tests pin this table.
export type SceneEntry = {
	readonly slug: string;
	readonly label: string;
	readonly id: number;
};

export const SCENES: readonly SceneEntry[] = Object.freeze([
	{ slug: "red", label: "Red", id: 0x80 },
	{ slug: "green", label: "Green", id: 0x81 },
	{ slug: "night", label: "Night", id: 0x82 },
	{ slug: "sunrise", label: "Sunrise", id: 0x83 },
	{ slug: "ghost", label: "Ghost", id: 0x84 },
	{ slug: "pink", label: "Pink", id: 0x85 },
	{ slug: "warmwhite", label: "Warm White", id: 0x86 },
	{ slug: "disco", label: "Disco", id: 0x87 },
	{ slug: "party", label: "Party", id: 0x88 },
	{ slug: "rgbfade", label: "RGB Fade", id: 0x89 },
	{ slug: "rainbowfade", label: "Rainbow Fade", id: 0x8a },
	{ slug: "redpulse", label: "Red Pulse", id: 0x8b },
	{ slug: "greenpulse", label: "Green Pulse", id: 0x8c },
	{ slug: "bluepulse", label: "Blue Pulse", id: 0x8d },
	{ slug: "amberpulse", label: "Amber Pulse", id: 0x8e },
	{ slug: "icepulse", label: "Ice Pulse", id: 0x8f },
	{ slug: "pinkpulse", label: "Pink Pulse", id: 0x90 },
	{ slug: "whitepulse", label: "White Pulse", id: 0x91 },
	{ slug: "greenredpulse", label: "Green Red Pulse", id: 0x92 },
	{ slug: "blueredpulse", label: "Blue Red Pulse", id: 0x93 },
] satisfies SceneEntry[]);

const MIN_SCENE_ID = 0x80;
const MAX_SCENE_ID = 0x93;

export const RAW_SCENE_IDS: readonly number[] = Object.freeze(
	Array.from({ length: MAX_SCENE_ID - MIN_SCENE_ID + 1 }, (_, index) => MIN_SCENE_ID + index),
);

// Unanchored, case-insensitive hex: embedded as an alternative in connection-link regexes.
export const SCENE_ROUTE_SOURCE = "scene\\/(?:[a-z]{1,40}|[0-9A-Fa-f]{2})";
// Anchored canonical form accepted by the bridge client.
export const SCENE_ROUTE = /^scene\/([a-z]{1,40}|[0-9A-F]{2})$/;

export function sceneHex(id: number): string {
	return id.toString(16).toUpperCase().padStart(2, "0");
}

// Returns the canonical selector (catalog slug, or uppercase hex without 0x), or undefined.
export function sceneSelector(value: string): string | undefined {
	if (typeof value !== "string") return undefined;
	const scene = SCENES.find((entry) => entry.slug === value);
	if (scene) return scene.slug;
	const match = /^(?:0[xX])?([0-9A-Fa-f]{2})$/.exec(value);
	if (!match) return undefined;
	const id = Number.parseInt(match[1]!, 16);
	if (id < MIN_SCENE_ID || id > MAX_SCENE_ID) return undefined;
	return sceneHex(id);
}

export function sceneLabel(selector: string): string | undefined {
	const canonical = sceneSelector(selector);
	if (canonical === undefined) return undefined;
	return SCENES.find((entry) => entry.slug === canonical)?.label ?? `ID ${canonical}`;
}
