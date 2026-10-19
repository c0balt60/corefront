import { RunService } from "@rbxts/services";
import { cleanup, effect, source, untrack } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { hasEffect, SPRINGS, type UiKind } from "core/Interface/client/theme";

/**
 * Seconds a component stays mounted after its `show` turns false, so its exit
 * animation can play. Return `$tuple(node, EXIT_TIME)` from a Show, Case or
 * Index child to delay its removal.
 */
export const EXIT_TIME = 0.3;

/**
 * A 0-1 spring that rises once the component mounts (after `delay` seconds, to
 * stagger siblings) and falls when `show` turns false. Drive transparency,
 * scale and offsets from it for enter and exit animations.
 */
export function useAppear(show: () => boolean = () => true, delay = 0, options = SPRINGS.smooth): () => number {
	const [value, spring] = useSpring(0, options);
	let pending: thread | undefined;

	effect(() => {
		const visible = show();
		if (pending) task.cancel(pending);
		pending = undefined;

		if (visible && delay > 0) {
			pending = task.delay(delay, () => {
				pending = undefined;
				spring.setGoal(1);
			});
		} else {
			spring.setGoal(visible ? 1 : 0);
		}
	});
	cleanup(() => {
		if (pending) task.cancel(pending);
	});

	return value;
}

/**
 * An angle in degrees that turns every frame at `speed()` degrees per second.
 * The speed can change at any time without the angle jumping. Drives the
 * rotation of energy borders. While `active()` is false it holds still, so
 * nothing bound to it updates.
 */
export function useSpin(speed: () => number, active: () => boolean = () => true): () => number {
	const angle = source(math.random(0, 359));
	cleanup(
		RunService.RenderStepped.Connect((dt) => {
			if (active()) angle((angle() + dt * speed()) % 360);
		}),
	);
	return angle;
}

const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&/<>=+";

function glyph() {
	const index = math.random(1, GLYPHS.size());
	return GLYPHS.sub(index, index);
}

/** `text` with the part past `progress` (0-1) replaced by random glyphs. Spaces stay put, so words keep their shape. */
function scramble(text: string, progress: number) {
	const chars = new Array<string>();
	for (const [, code] of utf8.codes(text)) chars.push(utf8.char(code));

	const revealed = math.floor(chars.size() * progress);
	return chars.map((char, index) => (index < revealed || char === " " ? char : glyph())).join("");
}

/**
 * `text()` decoded like a terminal: every time it changes, it shows as random
 * glyphs that settle into the real characters from left to right over
 * `duration` seconds. With `delay`, it stays blank that long when it first
 * mounts, to stagger siblings. Without `decode` for its kind, it is just `text`.
 */
export function useScramble(kind: UiKind, text: () => string, delay = 0, duration = 0.4): () => string {
	if (!hasEffect(kind, "decode")) return text;

	const output = source(delay > 0 ? "" : scramble(untrack(text), 0));
	let thread: thread | undefined;
	let last: string | undefined;

	effect(() => {
		const target = text();
		// Its sources can fire with the same text (a fresh state object, say): only new text decodes again.
		if (target === last) return;
		last = target;
		if (thread) task.cancel(thread);

		thread = task.defer(() => {
			if (delay > 0) task.wait(delay);
			delay = 0;
			const startedAt = os.clock();
			let progress = 0;
			while (progress < 1) {
				progress = math.min((os.clock() - startedAt) / duration, 1);
				output(scramble(target, progress));
				task.wait(1 / 30);
			}
			thread = undefined;
		});
	});
	cleanup(() => {
		if (thread) task.cancel(thread);
	});

	return output;
}
