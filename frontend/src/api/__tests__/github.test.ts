import { describe, expect, it } from "vitest";
import { parseGithubSource } from "../github";

describe("parseGithubSource", () => {
  it("parses a tree url with sub path", () => {
    expect(
      parseGithubSource("?github=https://github.com/o/r/tree/feat/tests/a"),
    ).toMatchObject({ ref: "feat", path: "tests/a", rest: "feat/tests/a" });
  });
  it("parses short form with ref and path params", () => {
    expect(parseGithubSource("?github=o/r&ref=a/b&path=t")).toMatchObject({
      owner: "o",
      repo: "r",
      ref: "a/b",
      path: "t",
    });
  });
  it("defaults ref to HEAD", () => {
    expect(parseGithubSource("?github=https://github.com/o/r")?.ref).toBe("HEAD");
  });
  it("returns null without param or on junk", () => {
    expect(parseGithubSource("")).toBeNull();
    expect(parseGithubSource("?github=nope")).toBeNull();
  });
});
