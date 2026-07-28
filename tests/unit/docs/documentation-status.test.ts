import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("documentation status contracts", () => {
  it("indexes every numbered feature specification from the docs hub", () => {
    const hub = read("docs/README.md");
    const specs = readdirSync(join(root, "docs/specs"))
      .filter((name) => /^F\d+-.+\.md$/.test(name))
      .sort();

    for (const spec of specs) {
      expect(hub, `${spec} is missing from docs/README.md`).toContain(
        `./specs/${spec}`,
      );
    }
  });

  it("labels the dated validation audit and points to the live registry", () => {
    const validation = read("docs/FEATURE_VALIDATION.md");

    expect(validation).toContain("Historical snapshot");
    expect(validation).toContain("[MVP_SCOPE.md](./MVP_SCOPE.md)");
  });

  it("keeps public feature claims bounded by the current contracts", () => {
    const readme = read("README.md");
    const landing = read("src/app/page.tsx");
    const composeSpec = read("docs/specs/F05-compose-send.md");
    const registry = read("docs/MVP_SCOPE.md");

    expect(readme).not.toContain("Gmail-class");
    expect(readme).not.toContain("full-text search");
    expect(readme).toContain("separately deployed IMAP/SMTP bridge");
    expect(landing).toContain("durable queued delivery");
    expect(landing).toContain("separate IMAP/SMTP bridge");
    expect(composeSpec).toContain("Tiptap WYSIWYG compose form");
    expect(composeSpec).toContain("server-derived plain-text alternative");
    expect(registry).toContain("| Advanced composer extensions |");
  });
});
