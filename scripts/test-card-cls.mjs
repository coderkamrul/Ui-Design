import fs from "fs";
import { convertHtml, resolveUtilityClasses } from "../lib/snapshot-import.js";

const cls = "flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center";
console.log("Resolved classes for search card:");
console.log(resolveUtilityClasses(cls));
