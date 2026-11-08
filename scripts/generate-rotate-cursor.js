const sharp = require('sharp');
const fs = require('fs');

// Figma standard rotation cursor:
// A curved bidirectional arrow with a circular arc, sharp arrowheads,
// crisp 1px white border, dark solid interior, and subtle 1px shadow.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
  <!-- Subtle soft shadow -->
  <g opacity="0.38" transform="translate(0, 1)">
    <path d="M 8 13 A 8 8 0 0 1 22 13" fill="none" stroke="#000" stroke-width="4.2" stroke-linecap="round"/>
    <polygon points="8.5,7 3.5,13.5 10.5,13.5" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/>
    <polygon points="21.5,7 26.5,13.5 19.5,13.5" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/>
  </g>
  <!-- Crisp white outline -->
  <g>
    <path d="M 8 13 A 8 8 0 0 1 22 13" fill="none" stroke="#ffffff" stroke-width="3.6" stroke-linecap="round"/>
    <polygon points="8.5,7.2 4,13.5 10.5,13.5" fill="#ffffff" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/>
    <polygon points="21.5,7.2 26,13.5 19.5,13.5" fill="#ffffff" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/>
  </g>
  <!-- Sharp dark charcoal interior -->
  <g>
    <path d="M 8 13 A 8 8 0 0 1 22 13" fill="none" stroke="#18181b" stroke-width="1.8" stroke-linecap="round"/>
    <polygon points="8.5,8.8 5.6,13 9.8,13" fill="#18181b"/>
    <polygon points="21.5,8.8 24.4,13 20.2,13" fill="#18181b"/>
  </g>
</svg>`;

sharp(Buffer.from(svg))
  .webp({ quality: 100 })
  .toFile('public/cursors/all/cursor-rotate-normal.webp')
  .then(() => {
    console.log('Successfully generated public/cursors/all/cursor-rotate-normal.webp');
  });
