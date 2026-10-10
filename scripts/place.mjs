// Every place command: `node scripts/place.mjs <build|watch|serve|dev> [place...] [--open]`.
// A place is any folder in places/ with a .rogen.json, and its code is src/core + src/<place>.
// `build` with no place builds them all. `--open` opens each built place in Studio.
// The build and serve tools come from tooling.json, or the BUILD_TOOL / SERVE_TOOL env vars.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, watch, writeFileSync } from "node:fs";

const TOOLS = ["argon", "rojo"];
const COMMANDS = ["build", "watch", "serve", "dev"];
const PLACES = readdirSync("places").filter((place) => existsSync(`places/${place}/.rogen.json`));

const [command, ...rest] = process.argv.slice(2);
const open = rest.includes("--open");
const places = rest.filter((arg) => !arg.startsWith("--"));

const usage = `Usage: pnpm <${COMMANDS.join("|")}> <place> [--open]. Places: ${PLACES.join(", ")}`;
if (!COMMANDS.includes(command)) fail(usage);
for (const place of places) if (!PLACES.includes(place)) fail(`Unknown place "${place}". ${usage}`);
if (command !== "build" && places.length !== 1) fail(`${command} takes exactly one place. ${usage}`);

function fail(message) {
	console.error(message);
	process.exit(1);
}

function tool(step) {
	const name = process.env[`${step.toUpperCase()}_TOOL`] || JSON.parse(readFileSync("tooling.json", "utf8"))[step];
	if (!TOOLS.includes(name)) fail(`Unknown ${step} tool "${name}", expected: ${TOOLS.join(", ")}`);
	return name;
}

/** Runs a shell command, and exits with its code if it fails. */
function run(line) {
	const { status } = spawnSync(line, { shell: true, stdio: "inherit" });
	if (status !== 0) process.exit(status ?? 1);
}

function rogen(place, mode) {
	return `rogen -c places/${place}/.rogen.json -m ts ${mode}`;
}

function rbxtsc(place, watchMode) {
	const dir = `places/${place}`;
	return `rbxtsc -p tsconfig.${place}.json --rojo ${dir}/default.project.json --includePath ${dir}/include${watchMode ? " -w" : ""}`;
}

/** Writes the place's tsconfig and include folder, and generates its project file once. */
function prepare(place) {
	mkdirSync(`places/${place}/include`, { recursive: true });
	// roblox-ts needs each tsconfig at the root, next to node_modules, so it's generated here.
	const tsconfig = {
		extends: "./tsconfig.json",
		compilerOptions: {
			rootDir: "src",
			outDir: `places/${place}/out`,
			tsBuildInfoFile: `places/${place}/out/tsconfig.tsbuildinfo`,
		},
		include: ["src/core", `src/${place}`],
	};
	writeFileSync(`tsconfig.${place}.json`, JSON.stringify(tsconfig, null, "\t") + "\n");
	run(rogen(place, "build"));
}

/**
 * The project file for `tool`. Rojo rejects fields it doesn't know, like Argon's `syncback`,
 * so it gets a copy without them, next to the original so relative `$path`s still resolve.
 * With `follow`, the copy is refreshed whenever Rogen rewrites the original.
 */
function projectFor(place, name, follow) {
	const source = `places/${place}/default.project.json`;
	if (name !== "rojo") return source;

	const copy = `places/${place}/rojo.project.json`;
	const write = () => {
		const { syncback, ...project } = JSON.parse(readFileSync(source, "utf8"));
		writeFileSync(copy, JSON.stringify(project, null, "\t"));
	};
	write();
	if (follow) {
		// Wait for the write to settle, since the first event can see a half-written file.
		let timer;
		watch(`places/${place}`, (_, file) => {
			if (file !== "default.project.json") return;
			clearTimeout(timer);
			timer = setTimeout(() => {
				try {
					write();
				} catch (error) {
					console.error(`Couldn't refresh ${copy}: ${error}`);
				}
			}, 200);
		});
	}
	return copy;
}

function build(place) {
	prepare(place);
	run(rbxtsc(place, false));

	const name = tool("build");
	const project = projectFor(place, name, false);
	const output = `places/${place}/${place}.rbxl`;
	if (name === "argon") {
		// Argon logs unreadable asset files as errors but still exits 0, so fail the build ourselves.
		const { status, stdout, stderr } = spawnSync(name, ["build", project, "-o", output, "-y", "-C", "never"], {
			encoding: "utf8",
		});
		const log = (stdout ?? "") + (stderr ?? "");
		process.stdout.write(log);
		if (status !== 0 || log.includes("ERROR")) process.exit(1);
	} else {
		run(`rojo build ${project} -o ${output}`);
	}

	if (open) run(`argon studio ${output}`);
}

function serve(place) {
	const name = tool("serve");
	const child = spawn(name, ["serve", projectFor(place, name, true)], { stdio: "inherit" });
	child.on("exit", (code) => process.exit(code ?? 1));
}

/** Rogen and rbxtsc in watch mode, plus the serve step for `dev`. */
function watchPlace(place, withServe) {
	prepare(place);
	const jobs = { rogen: rogen(place, "watch"), rbxtsc: rbxtsc(place, true) };
	if (withServe) jobs.serve = `node scripts/place.mjs serve ${place}`;
	const quoted = Object.values(jobs).map((job) => `"${job}"`);
	run(`concurrently -n ${Object.keys(jobs).join(",")} ${quoted.join(" ")}`);
}

if (command === "build") for (const place of places.length > 0 ? places : PLACES) build(place);
else if (command === "serve") serve(places[0]);
else watchPlace(places[0], command === "dev");
