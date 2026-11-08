import { convertSnapshotToCanvasNodes } from "../lib/snapshot-import.js";

const html = `<x-paper-html><div style="appearance: none; border-block-end-color: rgb(31, 31, 31); border-block-end-style: solid; border-block-start-color: rgb(31, 31, 31); border-block-start-style: solid; border-bottom-color: rgb(31, 31, 31); border-bottom-style: solid; border-inline-end-color: rgb(31, 31, 31); border-inline-end-style: solid; border-inline-start-color: rgb(31, 31, 31); border-inline-start-style: solid; border-left-color: rgb(31, 31, 31); border-left-style: solid; border-right-color: rgb(31, 31, 31); border-right-style: solid; border-top-color: rgb(31, 31, 31); border-top-style: solid; box-sizing: border-box; caret-color: rgb(31, 31, 31); color: rgb(31, 31, 31); column-gap: 20px; column-rule-color: rgb(31, 31, 31); display: flex; flex-direction: column; width: 280px; height: 162px; background-color: rgb(242, 242, 242);"><div>Content</div></div></x-paper-html>`;

const res = await convertSnapshotToCanvasNodes(html, { measure: false, exactLayout: true });
console.log("Root count:", res.rootIds.length);
const root = res.nodes[res.rootIds[0]];
console.log("Root type:", root.type);
console.log("Root w, h:", root.w, root.h);
console.log("Root layout:", root.layout);
console.log("Root customCss:", root.style?.customCss);
console.log("Root rawStyle:", root.rawStyle);
