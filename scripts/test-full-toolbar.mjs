import { parseHtmlFragment, convertSnapshotToCanvasNodes, formatNodeForCanvasTool } from '../lib/snapshot-import.js';

// Construct the full 11 tools HTML
const fullToolbarHtml = `
<div class="flex flex-col items-center py-2.5 gap-1.5 w-full" style="display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 6px; width: 40px; height: 462px;">
  <!-- 1. Pointer (Select Arrow - V) -->
  <div class="relative group" style="position: relative;">
    <button type="button" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: rgb(255, 255, 255); border: 1px solid rgb(226, 226, 226);">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; color: rgb(24, 24, 27);">
        <polygon points="4 3 11 20 14 13 21 10 4 3"></polygon>
      </svg>
    </button>
  </div>

  <!-- 2. Hand (Pan - H / Space) -->
  <div class="relative group" style="position: relative;">
    <button type="button" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; color: rgb(113, 113, 122);">
        <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v7M10 10.5V6a2 2 0 0 0-4 0v8a7 7 0 0 0 14 0v-4a2 2 0 0 0-4 0"></path>
      </svg>
    </button>
  </div>

  <!-- 2b. Breakpoints -->
  <div class="relative" style="position: relative;">
    <button type="button" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 17px; height: 17px; color: rgb(113, 113, 122);">
        <path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"></path>
        <path d="M10 19v-3.96 3.15"></path>
        <path d="M7 19h5"></path>
        <rect width="6" height="10" x="16" y="12" rx="2"></rect>
      </svg>
    </button>
  </div>

  <div style="width: 20px; height: 1px; background-color: rgb(226, 226, 226); margin: 4px 0;"></div>

  <!-- 3. Frame Tool -->
  <div class="relative group" style="position: relative;">
    <button type="button" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; color: rgb(113, 113, 122);">
        <path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"></path>
      </svg>
    </button>
  </div>

  <!-- 4. Rectangle -->
  <div class="relative group" style="position: relative;">
    <button type="button" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 17px; height: 17px; color: rgb(113, 113, 122);">
        <rect x="3.5" y="3.5" width="17" height="17" rx="1.5"></rect>
      </svg>
    </button>
  </div>

  <!-- 5. Pen -->
  <div class="relative group" style="position: relative;">
    <button type="button" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; color: rgb(113, 113, 122);">
        <path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18"></path>
        <path d="m12 19 7-7 3 3-7 7-3-3z"></path>
        <circle cx="11" cy="11" r="1.5"></circle>
      </svg>
    </button>
  </div>

  <!-- 6. Text -->
  <div class="relative group" style="position: relative;">
    <button type="button" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 15px; color: rgb(113, 113, 122);">
      Aa
    </button>
  </div>

  <!-- 7. Comment -->
  <div class="relative group" style="position: relative;">
    <button type="button" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; color: rgb(113, 113, 122);">
        <path d="M12 21a9 9 0 1 0-9-9c0 3.2 1.7 6 4.3 7.6L4 22l3.4-1.2A8.96 8.96 0 0 0 12 21z"></path>
        <line x1="12" y1="8.5" x2="12" y2="15.5"></line>
        <line x1="8.5" y1="12" x2="15.5" y2="12"></line>
      </svg>
    </button>
  </div>

  <div style="width: 20px; height: 1px; background-color: rgb(226, 226, 226); margin: 4px 0;"></div>

  <!-- 8. Shaders -->
  <div class="relative group" style="position: relative;">
    <button type="button" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; color: rgb(113, 113, 122);">
        <path d="M12 2L2 12l10 10 10-10L12 2z"></path>
        <path d="M12 7L7 12l5 5 5-5-5-5z"></path>
      </svg>
    </button>
  </div>

  <!-- 9. Image -->
  <div class="relative group" style="position: relative;">
    <button type="button" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; color: rgb(113, 113, 122);">
        <rect x="3" y="5" width="14" height="14" rx="2"></rect>
        <circle cx="7.5" cy="9.5" r="1.5"></circle>
        <path d="m17 15-4.5-4.5L5 18"></path>
        <path d="M19 1.5v4M17 3.5h4" stroke-width="1.8"></path>
      </svg>
    </button>
  </div>

  <!-- 10. Add SVG -->
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

convertSnapshotToCanvasNodes(fullToolbarHtml, { measure: false }).then((res) => {
  console.log('Roots:', res.roots.length, 'All count:', res.all.length);
  const root = res.roots[0];
  console.log('Root:', root.name, 'size:', root.size, 'layout:', root.layout);
  console.log('Root direct child count:', root.childIds.length);
  root.childIds.forEach((cid, i) => {
    const c = res.nodes[cid];
    console.log(`Child ${i}:`, c.name, 'type:', c.type, 'x:', c.position?.x, 'y:', c.position?.y, 'w:', c.size?.w, 'h:', c.size?.h, 'childIds:', c.childIds?.length);
    if (c.childIds?.length) {
      c.childIds.forEach((gcid) => {
        const gc = res.nodes[gcid];
        console.log(`   Grandchild:`, gc.name, 'type:', gc.type, 'x:', gc.position?.x, 'y:', gc.position?.y, 'w:', gc.size?.w, 'h:', gc.size?.h, 'viewBox:', gc.viewBox, 'childIds:', gc.childIds?.length);
        if (gc.childIds?.length) {
          gc.childIds.forEach((ggcid) => {
            const ggc = res.nodes[ggcid];
            console.log(`      Great-Grandchild:`, ggc.name, 'type:', ggc.type, 'x:', ggc.position?.x, 'y:', ggc.position?.y, 'w:', ggc.size?.w, 'h:', ggc.size?.h, 'viewBox:', ggc.viewBox, 'childIds:', ggc.childIds?.length);
            if (ggc.childIds?.length) {
              ggc.childIds.forEach((gggcid) => {
                const gggc = res.nodes[gggcid];
                console.log(`         Great-Great-Grandchild:`, gggc.name, 'type:', gggc.type, 'd:', gggc.d, 'stroke:', gggc.stroke, 'fill:', gggc.fill);
              });
            }
          });
        }
      });
    }
  });
}).catch(console.error);
