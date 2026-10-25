export declare const nativeFiles: string[];
export declare const distributionNativeFiles: string[];
export declare function machoArchitectures(bytes: Buffer): string[];
export declare function validateNativePayload(
	pluginRoot: string,
	options?: { fullPackage?: boolean; hostArchitecture?: string; sourceRevision?: string; sourceTreeSHA256?: string },
): { manifest: Record<string, unknown>; supervisor: string; worker: string };
