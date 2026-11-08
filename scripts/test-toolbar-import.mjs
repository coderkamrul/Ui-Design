import { parseHtmlFragment, convertPlainTree, formatNodeForCanvasTool } from '../lib/snapshot-import.js';

const toolbarHtml = `
<div class="flex flex-col items-center py-2.5 gap-1.5 w-full" style="display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 6px; width: 40px;">
  <div class="relative group" style="position: relative;">
    <button type="button" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: rgb(255, 255, 255); border: 1px solid rgb(226, 226, 226);">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; color: rgb(24, 24, 27);">
        <polygon points="4 3 11 20 14 13 21 10 4 3"></polygon>
      </svg>
    </button>
    <div style="position: absolute; left: 44px; top: 50%; opacity: 0; display: flex;">
      <span>Move</span>
      <span>V</span>
    </div>
  </div>
  <div class="relative group" style="position: relative;">
    <button type="button" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; color: rgb(113, 113, 122);">
        <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v7M10 10.5V6a2 2 0 0 0-4 0v8a7 7 0 0 0 14 0v-4a2 2 0 0 0-4 0"></path>
      </svg>
    </button>
    <div style="position: absolute; left: 44px; top: 50%; opacity: 0; display: flex;">
      <span>Pan</span>
      <span>H / Space</span>
    </div>
  </div>
  <div style="width: 20px; height: 1px; background-color: rgb(226, 226, 226); margin: 4px 0;"></div>
  <div class="relative group" style="position: relative;">
    <button type="button" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; color: rgb(113, 113, 122);">
        <rect x="3.5" y="5.5" width="14" height="14" rx="1.5"></rect>
        <circle cx="3.5" cy="5.5" r="1.2" fill="currentColor"></circle>
        <circle cx="17.5" cy="5.5" r="1.2" fill="currentColor"></circle>
        <circle cx="3.5" cy="19.5" r="1.2" fill="currentColor"></circle>
        <circle cx="17.5" cy="19.5" r="1.2" fill="currentColor"></circle>
      </svg>
    </button>
  </div>
</div>
`;

const roots = parseHtmlFragment(toolbarHtml);
const res = convertPlainTree(roots, { exactLayout: true });
console.log('Roots:', res.roots.length, 'All:', res.all.length);
for (const n of res.all) {
  formatNodeForCanvasTool(n);
  console.log({
    id: n.id,
    type: n.type,
    name: n.name,
    x: n.position?.x,
    y: n.position?.y,
    w: n.size?.w,
    h: n.size?.h,
    parentId: n.parentId,
    childIds: n.childIds,
    d: n.d ? n.d.slice(0, 30) : undefined,
    viewBox: n.viewBox,
    hidden: n.hidden,
    opacity: n.opacity
  });
}
