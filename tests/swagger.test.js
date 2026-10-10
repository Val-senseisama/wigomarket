jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));

const SwaggerParser = require("swagger-parser");
const { specs } = require("../swagger");
const app = require("../app");

// Every route file's @swagger blocks end up in one OpenAPI document. A single
// malformed block (bad indentation, an unquoted comma in a flow mapping, a
// missing `responses`) makes the whole spec invalid, so validate it as a unit.

const METHODS = ["get", "post", "put", "patch", "delete"];

// Registered on purpose without their own docs.
const UNDOCUMENTED_ROUTES = new Set([
  "GET /", // health check
  "POST /api/payment/webhook", // legacy Flutterwave URL, described under /webhook/{provider}
  "GET /api/banks/banks", // legacy paths, kept for /api/flutterwave callers
  "GET /api/banks/banks/{}",
]);
const UNDOCUMENTED_PREFIXES = ["/api/flutterwave"]; // deprecated alias mount of /api/banks

// Documented without being an Express route.
const NON_EXPRESS_DOCS = new Set(["GET /ws/location"]); // WebSocket upgrade

const norm = (path) => path.replace(/:\w+/g, "{}").replace(/\{[^}]+\}/g, "{}").replace(/(.)\/$/, "$1");

/** "METHOD /path" for every route Express has registered. */
function registeredRoutes() {
  const out = new Set();
  const mountOf = (layer) => {
    const src = layer.regexp.source
      .replace("^\\", "")
      .replace("\\/?(?=\\/|$)", "")
      .replace(/\\\//g, "/");
    return src === "^/?$" || src === "/?$" ? "" : `/${src.replace(/^\//, "")}`;
  };
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) {
          out.add(`${m.toUpperCase()} ${norm(prefix + layer.route.path) || "/"}`);
        }
      } else if (layer.name === "router" && layer.handle.stack) {
        walk(layer.handle.stack, prefix + mountOf(layer));
      }
    }
  };
  walk(app._router.stack, "");
  return out;
}

function documentedRoutes() {
  const out = new Set();
  for (const [path, ops] of Object.entries(specs.paths)) {
    for (const m of Object.keys(ops)) {
      if (METHODS.includes(m)) out.add(`${m.toUpperCase()} ${norm(path)}`);
    }
  }
  return out;
}

describe("OpenAPI spec", () => {
  it("is valid", async () => {
    await expect(SwaggerParser.validate(JSON.parse(JSON.stringify(specs)))).resolves.toBeTruthy();
  });

  it("has no Express-style or duplicated mount paths", () => {
    const bad = Object.keys(specs.paths).filter(
      (p) =>
        p.includes("/:") || // Express syntax; OpenAPI needs {param}
        !/^\/(api|ws)\//.test(p) || // every route is mounted under /api (or /ws for sockets)
        /\/api\/([^/]+)\/\1(\/|$)/.test(p), // mount prefix repeated, e.g. /api/rating/rating
    );
    expect(bad).toEqual([]);
  });

  it("documents only routes that exist", () => {
    const real = registeredRoutes();
    const phantom = [...documentedRoutes()].filter((d) => !real.has(d) && !NON_EXPRESS_DOCS.has(d));
    expect(phantom).toEqual([]);
  });

  it("documents every route", () => {
    const documented = documentedRoutes();
    const missing = [...registeredRoutes()].filter(
      (r) =>
        !documented.has(r) &&
        !UNDOCUMENTED_ROUTES.has(r) &&
        !UNDOCUMENTED_PREFIXES.some((p) => r.split(" ")[1].startsWith(p)),
    );
    expect(missing).toEqual([]);
  });
});
