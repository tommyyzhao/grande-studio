import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export type WithElementRef<T, E extends HTMLElement = HTMLElement> = T & {
	ref?: E | null;
};

export type WithoutChildren<T> = T extends { children?: unknown }
	? Omit<T, "children">
	: T;

export type WithoutChildrenOrChild<T> = T extends { children?: unknown; child?: unknown }
	? Omit<T, "children" | "child">
	: T extends { children?: unknown }
		? Omit<T, "children">
		: T extends { child?: unknown }
			? Omit<T, "child">
			: T;

export type WithoutChild<T> = T extends { child?: unknown }
	? Omit<T, "child">
	: T;

/**
 * Truncate a string at a word boundary, appending an ellipsis if shortened.
 * If the text fits within `max`, it is returned unchanged. Otherwise the
 * last whitespace before `max` is used as the cut point so words aren't
 * chopped mid-letter. Falls back to a hard cut if there is no whitespace.
 */
export function truncateAtWord(text: string, max: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	const slice = trimmed.slice(0, max);
	const lastSpace = slice.lastIndexOf(' ');
	const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
	return cut.trimEnd() + '…';
}
