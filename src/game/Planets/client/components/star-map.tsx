import { Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import Vide, { cleanup, effect, source } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Brackets, EnergyGradient } from "core/Interface/client/components/hud";
import { Shadow } from "core/Interface/client/components/shadow";
import { useAppear, useScramble, useSpin } from "core/Interface/client/motion";
import { COLORS, FONT_DISPLAY, FONT_LABEL, SPRINGS } from "core/Interface/client/theme";
import { generateStarSystem, type Planet } from "core/Worlds/shared/star-system";
import type { WorldState } from "game/Planets/shared/planets-network";

/** Where the star map floats: high above the spawn, so it never meets the playable world. */
export const ORIGIN = new Vector3(0, 1000, 0);

/** When planets started drifting. Module-wide, so the camera can follow a planet the map is drawing. */
const EPOCH = os.clock();

const STAR_SIZE = 10;
/** How fast a planet drifts round its orbit, in studs per second, and how fast it spins, in radians per second. */
const DRIFT = 1;
const SPIN = 0.4;
/** The target reticle round the selected planet, in planet diameters. */
const RETICLE_SCALE = 1.9;
/** Bezier handles that bend a quarter-circle beam into a near-perfect arc, as a fraction of the radius. */
const ARC_HANDLE = 0.5523;
const ORBIT_COLOR = Color3.fromRGB(120, 120, 132);
/** Points along a route beam, for the pulse running down it. A NumberSequence holds at most 20. */
const ROUTE_POINTS = 16;
/** Route lengths the pulse travels per second, and how far either side of it glows. */
const ROUTE_SPEED = 0.5;
const ROUTE_PULSE = 0.15;

/** A planet `t` seconds after `EPOCH`: drifting slowly round its orbit while it spins. */
function planetCFrame(planet: Planet, t: number) {
	const angle = planet.angle + (t * DRIFT) / planet.orbit;
	const position = ORIGIN.add(new Vector3(math.cos(angle) * planet.orbit, 0, math.sin(angle) * planet.orbit));
	return new CFrame(position).mul(CFrame.Angles(0, t * SPIN, 0));
}

/** Where a planet is on the map right now. */
export function planetPosition(planet: Planet) {
	return planetCFrame(planet, os.clock() - EPOCH).Position;
}

/**
 * A route beam's transparency: `opacity` all along, brighter round a pulse that
 * runs from the start to the end every 1 / `ROUTE_SPEED` seconds.
 */
function routeTransparency(t: number, opacity: number, reveal: number) {
	const head = (t * ROUTE_SPEED) % 1;
	const keypoints = new Array<NumberSequenceKeypoint>();
	for (let i = 0; i < ROUTE_POINTS; i++) {
		const x = i / (ROUTE_POINTS - 1);
		const pulse = math.max(0, 1 - math.abs(x - head) / ROUTE_PULSE);
		keypoints.push(new NumberSequenceKeypoint(x, 1 - reveal * math.min(opacity + 0.5 * pulse, 1)));
	}
	return new NumberSequence(keypoints);
}

/** `size * scale`, never below a sliver, so a spring overshooting past zero cannot give a part a negative size. */
function diameter(size: number, scale: number) {
	return math.max(size * scale, 0.001);
}

interface OrbitRingProps {
	readonly radius: number;
	/** 0 at rest, 0.5 hovered, 1 selected: how bright, wide and red the ring is. */
	readonly glow: () => number;
	/** 0-1: fades the ring in and out with its planet. */
	readonly reveal: () => number;
}

/**
 * A planet's orbit, drawn as four glowing beams bent into quarter circles.
 * Returns attachments and beams to go inside a part at `ORIGIN`.
 */
function OrbitRing({ radius, glow, reveal }: OrbitRingProps) {
	const points = [0, 1, 2, 3].map((quarter) => {
		const angle = (quarter * math.pi) / 2;
		const position = new Vector3(math.cos(angle) * radius, 0, math.sin(angle) * radius);
		// An attachment's X axis is where its beam's curve leaves from, so point it along the orbit.
		const tangent = new Vector3(-math.sin(angle), 0, math.cos(angle));
		return (<attachment CFrame={CFrame.fromMatrix(position, tangent, Vector3.yAxis)} />) as Attachment;
	});

	return [
		points,
		points.map((point, quarter) => (
			<beam
				Attachment0={point}
				Attachment1={points[(quarter + 1) % 4]}
				Color={() => new ColorSequence(ORBIT_COLOR.Lerp(COLORS.accent, math.clamp(glow(), 0, 1)))}
				CurveSize0={radius * ARC_HANDLE}
				CurveSize1={radius * ARC_HANDLE}
				FaceCamera={true}
				LightEmission={1}
				Segments={16}
				Transparency={() => new NumberSequence(1 - (0.25 + 0.6 * glow()) * reveal())}
				Width0={() => 0.2 + 0.25 * glow()}
				Width1={() => 0.2 + 0.25 * glow()}
			/>
		)),
	];
}

interface PlanetLabelProps {
	readonly planet: Planet;
	readonly index: number;
	readonly body: Part;
	readonly unlocked: () => boolean;
	readonly selected: () => boolean;
	/** Whether the cursor is over the planet itself, not just the label. */
	readonly pointed: () => boolean;
	/** 0-1: fades the label in and out with its planet. */
	readonly reveal: () => number;
	readonly onSelect: () => void;
}

/**
 * The clickable name over one planet, on a small chip with energy running
 * round its outline. The name decodes as the planet pops in. Unlocked planets
 * are bigger and white, locked ones dim and tagged. Hovering the chip or the
 * planet grows the chip and lights it, and the selected planet's turns accent
 * and pops.
 */
function PlanetLabel({ planet, index, body, unlocked, selected, pointed, reveal, onSelect }: PlanetLabelProps) {
	const hovered = source(false);
	const active = () => hovered() || pointed();
	const color = () => (selected() ? COLORS.accent : unlocked() ? COLORS.text : COLORS.subtext);
	const name = useScramble("chip", () => planet.name, 0.3 + index * 0.08, 0.5);

	const [lift, liftSpring] = useSpring(0, SPRINGS.responsive);
	const [scale, scaleSpring] = useSpring(1, SPRINGS.bouncy);
	const [tint, tintSpring] = useSpring(color(), SPRINGS.responsive);
	// 1 once unlocked and 0 while locked: how big, bright and solid the label is.
	const [rank, rankSpring] = useSpring(unlocked() ? 1 : 0, SPRINGS.smooth);

	effect(() => {
		liftSpring.setGoal(active() ? 1 : selected() ? 0.5 : 0);
		scaleSpring.setGoal(active() ? 1.12 : 1);
		tintSpring.setGoal(color());
		rankSpring.setGoal(unlocked() ? 1 : 0);
	});
	effect(() => {
		if (selected()) scaleSpring.impulse(3);
	});

	return (
		<billboardgui
			Adornee={body}
			AlwaysOnTop={true}
			LightInfluence={0}
			Name={planet.name}
			Size={UDim2.fromOffset(200, 40)}
			StudsOffset={new Vector3(0, planet.size / 2 + 3, 0)}
		>
			<frame
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(0.5, 0.5)}
				Size={() => UDim2.fromScale(0.7 + 0.3 * rank(), 0.8 + 0.2 * rank())}
			>
				<uiscale Scale={scale} />
				<Shadow
					lift={lift}
					glow={COLORS.accent}
					scale={0.5}
					visibility={() => reveal() * (0.4 + 0.6 * rank())}
				/>
				<textbutton
					AutoButtonColor={false}
					BackgroundColor3={COLORS.card}
					BackgroundTransparency={() => 1 - (0.3 + 0.25 * rank()) * reveal()}
					FontFace={FONT_DISPLAY}
					Size={UDim2.fromScale(1, 1)}
					Text={name}
					TextColor3={tint}
					TextScaled={true}
					TextTransparency={() => 1 - reveal()}
					ZIndex={1}
					MouseEnter={() => hovered(true)}
					MouseLeave={() => hovered(false)}
					Activated={onSelect}
				>
					<uicorner CornerRadius={new UDim(0.3, 0)} />
					<uipadding
						PaddingBottom={new UDim(0.2, 0)}
						PaddingLeft={new UDim(0.08, 0)}
						PaddingRight={new UDim(0.08, 0)}
						PaddingTop={new UDim(0.2, 0)}
					/>
					<uistroke
						ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
						Color={COLORS.text}
						Thickness={1.5}
						Transparency={() => 1 - reveal()}
					>
						<EnergyGradient
							kind="chip"
							base={() => COLORS.stroke.Lerp(COLORS.accent, math.clamp(lift(), 0, 1) * 0.8)}
							charge={lift}
						/>
					</uistroke>
				</textbutton>
				<textlabel
					AnchorPoint={new Vector2(0.5, 0)}
					BackgroundTransparency={1}
					FontFace={FONT_LABEL}
					Position={new UDim2(0.5, 0, 1, 3)}
					Size={UDim2.fromScale(0.5, 0.38)}
					Text="LOCKED"
					TextColor3={COLORS.subtext}
					TextScaled={true}
					TextTransparency={() => 1 - reveal() * (1 - rank())}
				/>
			</frame>
		</billboardgui>
	);
}

interface ReticleProps {
	readonly body: () => Part;
	readonly size: () => number;
	/** 0-1: fades the reticle in and out with the map. */
	readonly reveal: () => number;
}

/**
 * Targeting brackets round the selected planet. They turn slowly, and every
 * new selection snaps them in from wide, like a lock-on.
 */
function Reticle({ body, size, reveal }: ReticleProps) {
	const angle = useSpin(() => 35);
	const [lock, lockSpring] = useSpring(1, SPRINGS.bouncy);
	effect(() => {
		body();
		lockSpring.setPosition(2.4);
		lockSpring.halt();
		lockSpring.setGoal(1);
	});

	return (
		<billboardgui
			Adornee={body}
			AlwaysOnTop={true}
			LightInfluence={0}
			Name="Reticle"
			Size={() => UDim2.fromScale(size() * RETICLE_SCALE, size() * RETICLE_SCALE)}
		>
			<frame
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(0.5, 0.5)}
				Rotation={angle}
				Size={UDim2.fromScale(1, 1)}
			>
				<uiscale Scale={lock} />
				<Brackets
					kind="reticle"
					open={() => 0.3}
					length={12}
					visibility={() => reveal() * math.clamp(2.4 - lock(), 0, 1)}
				/>
			</frame>
		</billboardgui>
	);
}

interface StarMapProps {
	readonly world: () => WorldState;
	readonly selected: () => number;
	/** The planet under the cursor, if any. */
	readonly hovered: () => number | undefined;
	readonly onSelect: (planet: number) => void;
	/** Planets the team can travel to from the active one, each drawn as a route. */
	readonly routes?: () => ReadonlyArray<number>;
	/** Whether the routes are retreats, which lose the base here: drawn red. */
	readonly retreat?: () => boolean;
	/**
	 * Turns false to shrink and fade the map away. Return `$tuple(node, EXIT_TIME)`
	 * from the Show that renders it, so it stays mounted while it does.
	 */
	readonly show?: () => boolean;
}

/**
 * The world's star system as parts in the Workspace, built from the seed, with a
 * clickable label over each planet and a glowing ring along each orbit. The
 * planets pop in one after another and drift round the star, which pulses
 * inside a shimmering corona. The selected planet is outlined, its orbit lights
 * up and a reticle locks onto it, and the hovered one is outlined too. A beam
 * runs from the planet the team is on to each it can travel to, with a pulse
 * flowing toward the destination; the selected route is brighter. Renders
 * nothing into the tree: everything it makes is destroyed with its scope.
 */
export function StarMap({
	world,
	selected,
	hovered,
	onSelect,
	routes = () => [],
	retreat = () => false,
	show,
}: StarMapProps) {
	const { planets } = generateStarSystem(world().seed, world().sandbox);

	// Every drift, spin and pulse below is driven by this one source.
	const now = source(os.clock() - EPOCH);
	cleanup(RunService.RenderStepped.Connect(() => now(os.clock() - EPOCH)));

	const reveal = useAppear(show);
	const reveals = planets.map((_, index) => useAppear(show, 0.15 + index * 0.07, SPRINGS.bouncy));
	const glows = planets.map((_, index) => {
		const [glow, glowSpring] = useSpring(0, SPRINGS.smooth);
		effect(() => glowSpring.setGoal(selected() === index ? 1 : hovered() === index ? 0.5 : 0));
		return glow;
	});
	const pulse = () => math.sin(now() * 1.6);

	const bodies = planets.map(
		(planet, index) =>
			(
				<part
					Anchored={true}
					CanCollide={false}
					CFrame={() => planetCFrame(planet, now())}
					Color={planet.color}
					Material={Enum.Material.SmoothPlastic}
					Name={planet.name}
					Shape={Enum.PartType.Ball}
					Size={() => Vector3.one.mul(diameter(planet.size, reveals[index]()))}
				/>
			) as Part,
	);
	// Route ends ride inside the planets, so the beams follow them round their orbits.
	const ends = bodies.map((body) => (<attachment Name="RouteEnd" Parent={body} />) as Attachment);
	const routeColor = (index: number) =>
		retreat() ? COLORS.danger : selected() === index ? COLORS.accent : ORBIT_COLOR.Lerp(COLORS.text, 0.4);
	const hoveredBody = () => {
		const index = hovered();
		return index !== undefined && index !== selected() ? bodies[index] : undefined;
	};

	cleanup(
		(
			<folder Name="StarMap" Parent={Workspace}>
				<part
					Anchored={true}
					CanCollide={false}
					Color={Color3.fromRGB(255, 170, 60)}
					Material={Enum.Material.Neon}
					Name="Star"
					Position={ORIGIN}
					Shape={Enum.PartType.Ball}
					Size={() => Vector3.one.mul(diameter(STAR_SIZE, reveal() * (1 + 0.04 * pulse())))}
				>
					<pointlight Brightness={() => 2 + 0.4 * pulse()} Color={Color3.fromRGB(255, 190, 110)} Range={60} />
				</part>
				{/* A shimmering shell round the star, breathing out of step with it. */}
				<part
					Anchored={true}
					CanCollide={false}
					CanQuery={false}
					Color={Color3.fromRGB(255, 120, 50)}
					Material={Enum.Material.ForceField}
					Name="Corona"
					Position={ORIGIN}
					Shape={Enum.PartType.Ball}
					Size={() => Vector3.one.mul(diameter(STAR_SIZE * 1.7, reveal() * (1 - 0.05 * pulse())))}
				/>
				{/* A dark disc under the system, to read as a plane. A cylinder's axis is X, so tip it onto its side. */}
				<part
					Anchored={true}
					CanCollide={false}
					CFrame={new CFrame(ORIGIN.sub(new Vector3(0, 8, 0))).mul(CFrame.Angles(0, 0, math.rad(90)))}
					Color={Color3.fromRGB(14, 14, 18)}
					Material={Enum.Material.SmoothPlastic}
					Name="Plane"
					Shape={Enum.PartType.Cylinder}
					Size={new Vector3(1, 320, 320)}
					Transparency={() => 1 - reveal()}
				/>
				<part
					Anchored={true}
					CanCollide={false}
					CanQuery={false}
					Name="Orbits"
					Position={ORIGIN}
					Size={Vector3.one}
					Transparency={1}
				>
					{planets.map((planet, index) => (
						<OrbitRing
							radius={planet.orbit}
							glow={glows[index]}
							reveal={() => math.clamp(reveals[index](), 0, 1)}
						/>
					))}
				</part>
				{bodies}
				{planets.map((_, index) => (
					<beam
						Attachment0={() => ends[world().active ?? index]}
						Attachment1={ends[index]}
						Color={() => new ColorSequence(routeColor(index))}
						Enabled={() => routes().includes(index)}
						FaceCamera={true}
						LightEmission={1}
						Name="Route"
						Segments={ROUTE_POINTS}
						Transparency={() =>
							routeTransparency(
								now(),
								selected() === index ? 0.55 : 0.2,
								math.clamp(reveals[index](), 0, 1),
							)
						}
						Width0={() => (selected() === index ? 0.6 : 0.3)}
						Width1={() => (selected() === index ? 0.6 : 0.3)}
					/>
				))}
				<highlight
					Adornee={() => bodies[selected()]}
					DepthMode={Enum.HighlightDepthMode.Occluded}
					FillColor={COLORS.accent}
					FillTransparency={() => 1 - 0.25 * reveal()}
					OutlineColor={COLORS.accent}
					OutlineTransparency={() => 1 - reveal()}
				/>
				<highlight
					Adornee={hoveredBody}
					DepthMode={Enum.HighlightDepthMode.Occluded}
					Enabled={() => hoveredBody() !== undefined}
					FillTransparency={1}
					OutlineColor={COLORS.text}
					OutlineTransparency={0.3}
				/>
			</folder>
		) as Folder,
	);

	cleanup(
		(
			<folder Name="StarMapLabels" Parent={Players.LocalPlayer.WaitForChild("PlayerGui")}>
				{planets.map((planet, index) => (
					<PlanetLabel
						planet={planet}
						index={index}
						body={bodies[index]}
						unlocked={() => world().unlocked.includes(index)}
						selected={() => selected() === index}
						pointed={() => hovered() === index}
						reveal={() => math.clamp(reveals[index](), 0, 1)}
						onSelect={() => onSelect(index)}
					/>
				))}
				<Reticle
					body={() => bodies[selected()]}
					size={() => planets[selected()].size}
					reveal={() => math.clamp(reveals[selected()](), 0, 1)}
				/>
			</folder>
		) as Folder,
	);
}

interface ControlsHintProps {
	/** Turns false to fade the hint out with the map. */
	readonly show: () => boolean;
}

/** How to move round the star map, in the bottom-right corner. It decodes in after the map has settled. */
export function ControlsHint({ show }: ControlsHintProps) {
	const appear = useAppear(show, 1.2);
	const touch = UserInputService.TouchEnabled && !UserInputService.MouseEnabled;
	const text = useScramble(
		"text",
		() =>
			touch
				? "DRAG  ROTATE   ·   TWO FINGERS  PAN   ·   PINCH  ZOOM   ·   TAP  SELECT"
				: "DRAG  ROTATE   ·   MIDDLE DRAG / WASD  PAN   ·   SCROLL  ZOOM   ·   R  RESET",
		1.2,
		0.7,
	);

	return (
		<textlabel
			AnchorPoint={new Vector2(1, 1)}
			BackgroundTransparency={1}
			FontFace={FONT_LABEL}
			Position={() => new UDim2(0.98, 0, 0.97, 12 * (1 - appear()))}
			Size={UDim2.fromScale(0.6, 0.025)}
			Text={text}
			TextColor3={COLORS.muted}
			TextScaled={true}
			TextTransparency={() => 1 - 0.8 * appear()}
			TextXAlignment={Enum.TextXAlignment.Right}
		>
			<uitextsizeconstraint MaxTextSize={14} />
		</textlabel>
	);
}
