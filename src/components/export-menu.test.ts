import { describe, expect, it } from "vitest";
import { EXPORT_TABLES } from "@saylent/report/data-export";
import { MENU_TABLES } from "./export-menu";

describe("Export menu", () => {
  it("offers exactly the documented export tables", () => {
    expect([...MENU_TABLES]).toEqual(EXPORT_TABLES);
  });
});
